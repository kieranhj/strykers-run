import json, re, sys, collections
# pccats.py PHASE.json [OUT.json] (tools/pcagg.py's OUT.json): a pass's cycles by what they do, with each group's routines
d = json.load(open(sys.argv[1]))
R = {   # phase -> [(group, regex)], first match wins; whatever is left is "other"
 'render': [
  ('restore', r'^(restore_block|restore_part|take_off|ck\d+_\w+_(restore|r\d))$'),   # ck: compiled kinds (tools/compiled.py)
  ('draw', r'^(draw_column|ren_draw_sprite|draw_mover|raise_address|up_a_cell|put_on|mark_part|compact|record_live|compiled_part|compiled_call|compiled_jump|ck\d+_\w+_(draw|d\d|ok\d)|compiled_unsafe_\d)$'),
  ('scenery', r'^(write_column|view_to_buffer|buffer_to_view|history_to_view|ren_plot_lives)$'),
  ('decide', r'.'),
 ],
 'logic': [
  ('scenery', r'^history_push$'),
  ('collide', r'collision|check_next_mover|search_for_target|consider_next_enemy|set_cm_left|cm_left_known|get_mover_X_type_and_height|use_height_table|calculate_mover_x_max|check_x_high|leave_with_carry_clear_28c9|skip_low_check_28b7|skip_overflow_28b1|skip_overflow_287c|check_in_full|search_in_full|friends_in_full|consider_next_mover_2abe|check_if_friendly|no_collision|not_hostile|leave_2865|check_for_target_behind_mover|check_for_hostile'),
  ('keys', r'keydown|keypress|player_input|key_not_pressed|not_paused'),
  ('walk', r'walk_column|plot_mover|set_mask_table_lookup_opcode|get_mover_Y_sprite|set_sprite_address|steps_known|steps_limited|walked|get_mover_type_and_colour|not_white|is_unflipped_1f14|is_flipped_1f25|get_mover_sprite_and_screen|get_sprite_and_screen_addresses|skip_unpacking'),
  ('move', r'.'),
 ],
 'scroll': [('scenery', r'.')],
 'irq': [('irq', r'.')],
 'wait': [('wait', r'.')],
}
out = collections.defaultdict(lambda: {'total': 0, 'parts': collections.Counter()})
for ph, cn in d.items():
    for name, v in cn.items():
        for g, r in R[ph]:
            if re.search(r, name):
                key = g if ph not in ('logic', 'render') or g != 'scenery' else 'scenery'
                out[key]['total'] += v; out[key]['parts'][ph + ':' + name] += v; break
tot = sum(x['total'] for x in out.values())
print('total', round(tot))
for g, x in sorted(out.items(), key=lambda kv: -kv[1]['total']):
    print('%-8s %7.0f %5.1f%%' % (g, x['total'], 100 * x['total'] / tot))
    for k, v in x['parts'].most_common(12): print('      %-60s %6.0f' % (k, v))
if len(sys.argv) > 2:
    json.dump({g: {'total': round(x['total']), 'parts': [[k.split(':', 1)[1], k.split(':')[0], round(v)] for k, v in x['parts'].most_common() if v >= 1]} for g, x in out.items()}, open(sys.argv[2], 'w'))
