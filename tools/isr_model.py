"""
isr_model.py - a declared model of the interrupt's exits into the MOS, for
beebgame's dataflow analyses (tools/dataflow, vendored and unmodified).

Stryker's Run, 2026-10-16. WHY. Upstream's Analysis._isr walks the code the
interrupt roots reach and unions what it reads and writes; if any of it has an
exit it cannot follow (a JMP to the MOS, a JMP (vector), a self-modified
instruction) or a store through a pointer, it takes the interrupt to read and
write ALL memory. Every handler here ends in the MOS (irq1_handler's chain
JMP &FFFF, the title handler's JMP (vector), the music handlers' OSWORD via
JMP (wordv)), so no memory byte was ever a known value anywhere. There is no
upstream config for an external routine's effects, so this replaces _isr in
the analysis's own process (tools/analyse.py installs it when the config sets
ISR_MODEL = True); the vendored files are not touched.

WHAT IT CHANGES, AND ONLY THAT. The same walk as upstream, per root, then:
  * an unknown exit at a site in the config's ISR_MOS_EXITS is the MOS: it
    returns (from the interrupt or the call) having read and written only
    MOS_WORKSPACE, which is added to the interrupt's reads and writes;
  * a store through a pointer at a site in ISR_POINTER_STORES writes only the
    address range given there, not all memory;
  * bytes in ISR_PRESERVES[root] are saved on entry and restored before exit
    by that root's handler, so they are not among ITS writes (the interrupted
    code sees them unchanged) - they still count if another root writes them;
  * any other unknown exit or unbounded pointer store still makes the
    interrupt read and write all memory, with a note naming the site, so a
    new exit cannot slip through.
Every site named in the config must be reached by the interrupt, or this stops.
"""

import sys


def _ranges_bits(an, ranges):
    b = 0
    for lo, hi in ranges:
        b |= an.mbits(lo, hi - lo + 1)
    return b


def install(analysis, C):
    """C: the config module (tools/dataflow_config.py), read directly, since
    gamecfg.load copies only the fields upstream knows."""
    exits = dict(getattr(C, 'ISR_MOS_EXITS', {}))
    pstores = dict(getattr(C, 'ISR_POINTER_STORES', {}))
    preserves = dict(getattr(C, 'ISR_PRESERVES', {}))
    mos = list(getattr(C, 'MOS_WORKSPACE', ()))
    STORES, RMW = analysis.STORES, analysis.RMW

    def _isr(self):
        P = self.P
        roots, root_name = [], {}
        for s in P.syms:
            if s['name'] in self.isr_names:
                for i in P.by_addr.get(s['val'], []):
                    if i.seg == s['seg']:
                        roots.append(i.key)
                        root_name[i.key] = s['name']
        self.isr_roots = roots

        def where(k):
            return P.where(P.insns[k])

        used_exits, used_ps, bad = set(), set(), []
        r_all = w_all = 0
        seen_all = set()
        for rk in roots:
            seen = set(); st = [rk]
            while st:
                k = st.pop()
                if k in seen:
                    continue
                seen.add(k)
                if k in self.unk or (k in self.call and not self.call[k]):
                    w_ = where(k)
                    if w_ in exits:
                        used_exits.add(w_)
                    else:
                        bad.append('unknown exit at %s (%s)' % (w_, P.disasm(P.insns[k])))
                for (t, e) in self.succ[k]:
                    st.append(t.key)
                for t in self.call.get(k) or ():
                    st.append(t.key)
            r = w = 0
            for k in seen:
                i = P.insns[k]
                rr, ww = self._mem_rw(i)
                if i.mode in ('inx', 'iny', 'zpi') and (i.mn in STORES or i.mn in RMW):
                    w_ = where(k)
                    if w_ in pstores:
                        used_ps.add(w_)
                        tgt = _ranges_bits(self, [pstores[w_]])
                        ptr = self.mb(i.opnd) | self.mb((i.opnd + 1) & 0xFF)
                        ww = tgt
                        rr = ptr | (tgt if i.mn in RMW else 0)
                    else:
                        bad.append('unbounded pointer store at %s (%s)' % (w_, P.disasm(i)))
                r |= rr; w |= ww
            keep = preserves.get(root_name[rk])
            if keep:
                w &= ~_ranges_bits(self, [(a, a) for a in keep])
            r_all |= r; w_all |= w
            seen_all |= seen
        self.isr_code = seen_all
        missing = [s for s in exits if s not in used_exits] + \
                  [s for s in pstores if s not in used_ps]
        if missing:
            sys.exit('isr_model: the config names sites the interrupt does not reach: %s' % missing)
        mosb = _ranges_bits(self, mos)
        r_all |= mosb; w_all |= mosb
        if bad or not roots:
            for b in sorted(set(bad)):
                self.notes.append('interrupt (isr_model): ' + b)
            self.notes.append('interrupt: an unresolved exit (or no root found) -- '
                              'it is taken to read and write all memory')
            r_all = w_all = self.MALL
        self.isr_r, self.isr_w = r_all, w_all
        self.notes.append('interrupt (isr_model): MOS exits %s modelled as touching only '
                          'MOS_WORKSPACE; pointer stores %s bounded; preserved bytes for %s'
                          % (sorted(used_exits), sorted(used_ps), sorted(preserves)))
        self.notes.append(f"interrupt roots {[root_name[k] for k in roots]}: "
                          f"{len(seen_all)} instructions, reads {bin(r_all).count('1')} and writes "
                          f"{bin(w_all).count('1')} universe bytes")
        self.notes.append('interrupt writes: ' + ' '.join('&%04X' % a for a in self.names_of(w_all & self.MALL)))

    analysis.Analysis._isr = _isr
