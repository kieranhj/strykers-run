.POSIX:
# ===========================================================================
# Makefile - Stryker's Run (Enhanced), built on any POSIX system.
#
#   make                 the optimised build: build/strykers.ssd (not compared)
#   make COMPARE=1       the same, then every file against the reference disc
#   make release         RELEASE=1: the build for other people (no DEBUG_ flags)
#   make original        the original disc, byte-identical to the reference, from
#                        the tag step1-byte-identical-rebuild: build/strykers-original.ssd
#   make clean           remove what this Makefile builds
#   make help            this list
#
# build.ps1 is the same build for Windows without make, and the two produce
# the SAME IMAGE, byte for byte: both stamp INFO and !BOOT through
# tools/build_stamp.py and pass Baron the same flags. Check with
#   python tools/dfs.py compare build/strykers.ssd other/strykers.ssd
# A change to the pipeline has to land in both.
#
# build.ps1's options, as variables (each combination names its own image,
# as build.ps1 names it):
#
#   .\build.ps1                         make                (-NoCompare: the same)
#   .\build.ps1 -Compare                make COMPARE=1
#   .\build.ps1 -Release                make release        (or RELEASE=1)
#   .\build.ps1 -Shift 256              make SHIFT=256      -> strykers-shift256.ssd
#   .\build.ps1 -Shift 256 -ShiftEnd    make SHIFT=256 SHIFTEND=1
#                                                           -> strykers-shift256end.ssd
#   .\build.ps1 -Define DEBUG_LIVES     make DEFINES=DEBUG_LIVES
#                                                           -> strykers-debug_lives.ssd
#   .\build.ps1 -Define A,B             make DEFINES=A,B    (or DEFINES="A B")
#
# COMPARE IS OFF BY DEFAULT, as in build.ps1: from step 2 the code
# deliberately differs from the reference (CLAUDE.md), so on main the check
# can only fail. As in build.ps1 it is made only on a build with no SHIFT
# and no DEFINES, and skipped with a note when the reference is absent.
#
# WHAT IT ASSUMES. Baron 0.5.3 and Python 3. BARON is found as build.ps1
# finds it: $BARON, then bin/baron, then baron on the PATH. Nothing here
# writes a `.exe` suffix - the platforms that need one supply it:
#
#   PYTHON=python3   BARON=
#
# THE RULES THIS FOLLOWS are beeb-port-kit's docs/build-portability.md:
# `.POSIX:` above (recipes run under `sh -e`, as BSD make runs them); no
# GNU extensions (no $(wildcard), ifeq, `%` rules or $(shell) - the flag
# handling is shell, inside the recipes); every source listed; a failed
# assembly leaves no image behind.
# ===========================================================================

PYTHON ?= python3
BARON  ?=

# The options (see above). Set on the command line; `release` sets RELEASE.
RELEASE  = 0
SHIFT    = 0
SHIFTEND = 0
DEFINES  =
COMPARE  = 0

# Every DEBUG_ and GAMEPLAY_ flag main.6502 reads. Baron cannot default a -D symbol, so
# each is passed on every build, 0 unless DEFINES names it (decision 9).
# A new flag goes here and in build.ps1's $flags.
FLAGS = DEBUG_LIVES DEBUG_FULLREDRAW GAMEPLAY_SHIELD GAMEPLAY_LIVES GAMEPLAY_TIMER GAMEPLAY_OPTIONS

# NOT overridable: main.6502 INCLUDEs "../build/build_time.6502".
BUILD = build

# Set by `all` through a recursive make, from SHIFT, SHIFTEND and DEFINES;
# these defaults are the plain build, for `make build/strykers.ssd`.
STEM = strykers
DEFS = -D DEBUG_LIVES=0 -D DEBUG_FULLREDRAW=0 -D GAMEPLAY_SHIELD=0 -D GAMEPLAY_LIVES=0 -D GAMEPLAY_TIMER=0 -D GAMEPLAY_OPTIONS=0

SSD    = $(BUILD)/$(STEM).ssd
LST    = $(BUILD)/$(STEM).lst
SYMS   = $(BUILD)/$(STEM).symbols.json
CONFIG = $(BUILD)/$(STEM).config

REFERENCE = reference/sth/StrykersRun.ssd

# The original: the step 1 source, exported from its tag and assembled as the
# tag's own build.ps1 assembled it.
TAG     = step1-byte-identical-rebuild
ORIG    = $(BUILD)/original
ORIGSSD = $(BUILD)/strykers-original.ssd

# Everything main.6502 INCLUDEs, directly or not. Adding a file to src/ means
# adding it here: there is no wildcard, deliberately - a build that silently
# ignores a new source is worse than one that has to be told about it.
#
# The GENERATED sources (sprite_*.6502 from tools/sprites.py, sfx_data.6502
# from tools/sfx50.py, lives_digits.6502 from tools/livesdigits.py) are
# committed, and the build does not regenerate them: their inputs are
# captures from a running build, not files in the tree.
SRC = \
  src/main.6502 src/os.6502 src/zp.6502 src/game.6502 src/font.6502 \
  src/bank4.6502 src/bank5.6502 src/bank6.6502 src/bank7.6502 \
  src/render.6502 src/render_zp.6502 src/lives_digits.6502 src/prebuild.6502 \
  src/sprite_andy.6502 src/sprite_columns.6502 src/sprite_straight.6502 src/compiled_table.6502 src/compiled_bank5.6502 src/compiled_bank6.6502 src/compiled_bank7.6502 src/compiled_hazel_a.6502 src/compiled_hazel_b.6502 src/music_packed.6502 src/lib/zx02depack.6502 \
  src/sfx_data.6502 src/title.6502 src/title_data.6502 src/loader.6502 \
  src/lib/boot_stamp.6502 src/lib/keydown.6502 src/lib/sfx50.6502 src/scroll_hazel.6502

# The baron to run, as build.ps1's Find-Tool finds it. A shell fragment, so
# that it costs nothing on a build that does not assemble; `[ -f bin/baron ]`
# also finds bin/baron.exe under MSYS2 and Git for Windows.
FINDBARON = baron="$(BARON)"; \
  if [ -z "$$baron" ]; then \
    if [ -f bin/baron ]; then baron=bin/baron; \
    elif command -v baron >/dev/null 2>&1; then baron=baron; \
    else echo "baron not found: set BARON=, or put baron in bin/ or on the PATH (README.md, Building)" >&2; \
      exit 1; fi; \
  fi

# Prints a file's SHA256 the way build.ps1 does (sha256sum is not on a Mac).
SHA256 = $(PYTHON) -c "import hashlib, sys; print('       sha256', hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest())"

.PHONY: all debug release gameplay original clean help

# The options become a name and a set of -D flags here, in the shell, exactly
# as build.ps1 makes them; the stamp runs; then a second make builds the image.
# That split is the point: build_stamp.py rewrites the .config only when the
# time or a flag changed, and the second make judges by that file's mtime. A
# stamp in the same graph would run every time, and make counts a target
# whose recipe RAN as updated - so everything would rebuild, always.
#
# AND WHEN THE .config DOES CHANGE, THE IMAGE IS REMOVED rather than left to
# the mtimes. `make release` then `make` writes the .config a fraction of a
# second after the release image, and a make that keeps whole seconds sees
# the two as the same age and keeps the release image under the debug build's
# name: measured here (GNU Make 4.4.1, ezwinports, NTFS, 2026-10-17), the
# .config 0.35 s newer and "older than target". HFS+ keeps whole seconds too.
all:
	@case "$(SHIFT)" in ''|*[!0-9]*) \
	    echo "SHIFT=$(SHIFT): a decimal number of bytes, as build.ps1's -Shift" >&2; exit 1 ;; esac; \
	case "$(SHIFTEND)" in 0|1) ;; *) echo "SHIFTEND=$(SHIFTEND): 0 or 1" >&2; exit 1 ;; esac; \
	case "$(RELEASE)" in 0|1) ;; *) echo "RELEASE=$(RELEASE): 0 or 1" >&2; exit 1 ;; esac; \
	stem=strykers; \
	if [ "$(SHIFT)" != 0 ]; then \
	    stem=$$stem-shift$(SHIFT); \
	    if [ "$(SHIFTEND)" = 1 ]; then stem=$${stem}end; fi; \
	fi; \
	for d in `echo "$(DEFINES)" | tr ',' ' '`; do \
	    k=$${d%%=*}; v=$${d#*=}; \
	    if [ "$$v" = "$$d" ] || [ -z "$$v" ]; then v=1; fi; \
	    known=0; for f in $(FLAGS); do if [ "$$f" = "$$k" ]; then known=1; fi; done; \
	    if [ $$known = 0 ]; then \
	        echo "unknown flag $$k (known: $(FLAGS))" >&2; exit 1; fi; \
	    eval "f_$$k=\$$v"; \
	    stem=$$stem-`echo "$$k" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz'`; \
	    if [ "$$v" != 1 ]; then stem=$$stem$$v; fi; \
	done; \
	defs=; stamp=; \
	for f in $(FLAGS); do \
	    eval "v=\$${f_$$f:-0}"; defs="$$defs -D $$f=$$v"; stamp="$$stamp $$f=$$v"; \
	done; \
	cfg=$(BUILD)/$$stem.config; \
	if [ -f $$cfg ]; then cp $$cfg $$cfg.prev; fi; \
	$(PYTHON) tools/build_stamp.py $(BUILD) $$stem.config RELEASE=$(RELEASE) \
	    SHIFT=$(SHIFT) SHIFT_END=$(SHIFTEND) $$stamp; \
	cmp -s $$cfg.prev $$cfg || rm -f $(BUILD)/$$stem.ssd; \
	rm -f $$cfg.prev; \
	$(MAKE) STEM=$$stem DEFS="$$defs" $(BUILD)/$$stem.ssd; \
	if [ "$(COMPARE)" = 1 ] && [ "$(SHIFT)" = 0 ] && [ -z "$(DEFINES)" ]; then \
	    if [ -f $(REFERENCE) ]; then \
	        $(PYTHON) tools/compare.py $(BUILD)/$$stem.ssd $(REFERENCE) || { \
	            echo "the build is not byte-identical to the reference" \
	                 "(expected from step 2 on: build without COMPARE=1)" >&2; exit 1; }; \
	    else \
	        echo "       (no $(REFERENCE): not compared - README.md says where it comes from)"; \
	    fi; \
	fi

debug: all

release:
	@$(MAKE) RELEASE=1 all
	@echo "RELEASE build: every DEBUG_ flag off"

# Every GAMEPLAY_ flag (decisions 43-47): the gameplay disc, also copied to
# build/strykers-gameplay.ssd (make gameplay RELEASE=1 for testers), as build.ps1 -Gameplay
gameplay:
	@$(MAKE) DEFINES=GAMEPLAY_SHIELD,GAMEPLAY_LIVES,GAMEPLAY_TIMER,GAMEPLAY_OPTIONS all
	@cp $(BUILD)/strykers-gameplay_shield-gameplay_lives-gameplay_timer-gameplay_options.ssd $(BUILD)/strykers-gameplay.ssd
	@cp $(BUILD)/strykers-gameplay_shield-gameplay_lives-gameplay_timer-gameplay_options.symbols.json $(BUILD)/strykers-gameplay.symbols.json
	@echo "       copied to $(BUILD)/strykers-gameplay.ssd"

# Only reached when the .config is missing and the image was asked for by
# name (`make build/strykers.ssd`); `all` always stamps first.
$(CONFIG):
	$(PYTHON) tools/build_stamp.py $(BUILD) $(STEM).config RELEASE=$(RELEASE) \
	    SHIFT=$(SHIFT) SHIFT_END=$(SHIFTEND) DEBUG_LIVES=0 DEBUG_FULLREDRAW=0 GAMEPLAY_SHIELD=0 GAMEPLAY_LIVES=0 GAMEPLAY_TIMER=0 GAMEPLAY_OPTIONS=0

# Baron writes the image, the symbol dump and (on stdout) the listing. A
# failed assembly removes the image and the dump, so a half-written image
# never looks current. --warn 2 adds Baron's opt-in audits; warnings go to
# stderr and never change the exit code.
$(SSD): $(SRC) $(CONFIG)
	@$(FINDBARON); \
	echo "  $$baron $(SSD)"; \
	"$$baron" --warn 2 -o $(SSD) --title 'STRYKERS RUN' --opt 2 \
	    -D RELEASE=$(RELEASE) -D SHIFT=$(SHIFT) -D SHIFT_END=$(SHIFTEND) $(DEFS) \
	    --symbols $(SYMS) -v src/main.6502 > $(LST) || \
	    { rm -f $(SSD) $(SYMS); echo "baron failed" >&2; exit 1; }
	@echo "Built  $(SSD)"
	@$(SHA256) $(SSD)

# ---------------------------------------------------------------------------
# The original disc
# ---------------------------------------------------------------------------
# The tag step1-byte-identical-rebuild (762a0d2) is the source rebuilt byte for byte from
# the original; everything after it is the optimisation, which changes the
# code. That tag predates this Makefile, so `make original` exports the
# tag's src/ and tools/ into $(ORIG) and assembles them with the flags the
# tag's own build.ps1 passed (it had one DEBUG_ flag; SHIFT_END was there).
#
# THE STAMP IS THE TAG'S COMMIT TIME, given to the tag's build_stamp.py as
# SOURCE_DATE_EPOCH - what a clean checkout of the tag stamps - so the image
# is the one `git worktree add ../strykers-original step1-byte-identical-rebuild` and the
# tag's build.ps1 produce there. Only INFO and !BOOT carry the stamp; the
# game's files, the ones compared, do not.
#
# The export is extracted into $(ORIG).tmp and renamed, so an interrupted
# one is never taken for a complete one. It depends on nothing: a tag does
# not move, and `make clean` starts it again.
$(ORIG)/src/main.6502:
	@git rev-parse -q --verify "$(TAG)^{commit}" >/dev/null || { \
	    echo "no tag $(TAG) here: the original needs a git clone with its tags" \
	         "(git fetch --tags)" >&2; exit 1; }
	rm -rf $(ORIG) $(ORIG).tmp $(ORIG).tar
	mkdir -p $(ORIG).tmp
	git archive -o $(ORIG).tar $(TAG) src tools
	cd $(ORIG).tmp && tar -xf ../original.tar
	rm -f $(ORIG).tar
	mv $(ORIG).tmp $(ORIG)

$(ORIGSSD): $(ORIG)/src/main.6502
	@$(FINDBARON); \
	sde=`git log -1 --format=%ct $(TAG)`; \
	SOURCE_DATE_EPOCH=$$sde $(PYTHON) $(ORIG)/tools/build_stamp.py \
	    $(ORIG)/build strykers.config RELEASE=0 SHIFT=0; \
	echo "  $$baron $(ORIGSSD)  ($(TAG))"; \
	"$$baron" --warn 2 -o $(ORIG)/build/strykers.ssd --title 'STRYKERS RUN' --opt 2 \
	    -D RELEASE=0 -D SHIFT=0 -D SHIFT_END=0 -D DEBUG_LIVES=0 \
	    --symbols $(ORIG)/build/strykers.symbols.json -v $(ORIG)/src/main.6502 \
	    > $(ORIG)/build/strykers.lst || \
	    { rm -f $(ORIG)/build/strykers.ssd $(ORIG)/build/strykers.symbols.json; \
	      echo "baron failed" >&2; exit 1; }
	cp $(ORIG)/build/strykers.ssd $(ORIGSSD).tmp
	mv $(ORIGSSD).tmp $(ORIGSSD)
	@echo "Built  $(ORIGSSD)  (listing and symbols in $(ORIG)/build/)"
	@$(SHA256) $(ORIGSSD)

original: $(ORIGSSD)
	@if [ -f $(REFERENCE) ]; then \
	    $(PYTHON) tools/compare.py $(ORIGSSD) $(REFERENCE); \
	else \
	    echo "       (no $(REFERENCE): not compared - README.md says where it comes from)"; \
	fi

# ---------------------------------------------------------------------------

# build/ is also where the test harnesses write their captures and
# screenshots, so this removes only what the Makefile and build.ps1 make.
clean:
	rm -f $(BUILD)/strykers*.ssd $(BUILD)/strykers*.lst \
	      $(BUILD)/strykers*.symbols.json $(BUILD)/strykers*.config \
	      $(BUILD)/strykers*.config.prev \
	      $(BUILD)/build_time.6502 $(BUILD)/build_time.6502.tmp
	rm -rf $(ORIG) $(ORIG).tmp $(ORIG).tar

help:
	@echo "make                 the optimised build -> build/strykers.ssd"
	@echo "make release         RELEASE=1: no DEBUG_ flags"
	@echo "make gameplay        every GAMEPLAY_ flag -> build/strykers-gameplay.ssd"
	@echo "make original        the original, from the tag $(TAG)"
	@echo "                     -> build/strykers-original.ssd, compared with the reference"
	@echo "make clean           remove what this Makefile builds (not the harnesses' files)"
	@echo "options:             COMPARE=1  SHIFT=n  SHIFTEND=1  DEFINES=A,B  RELEASE=1"
	@echo "                     (COMPARE=1 is build.ps1 -Compare; see the Makefile's header)"
	@echo "flags for DEFINES:   $(FLAGS)"
	@echo "overrides:           PYTHON BARON"
