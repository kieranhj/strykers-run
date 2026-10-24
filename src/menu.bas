# menu.bas - the release disc's MENU (tools/releasedisc.py tokenises it; lines starting # are dropped).
# The original release's MENU (reference/sth/StrykersRun.ssd), lines 110-180, with its choices
# changed: 1 the original game, faster (directory O), 2 Redux (directory R), each started by its
# own !BOOT (the machine check, the build stamp on a debug build, *TV255,1, *FX200,3, *RUN SRRUN).
# 2026-10-24 (KC): no garbage before the menu's picture, no MODE 7 cursor after it. A routine at &0900
# (the DATA, from tools/menublank.py; &0900 a sound and RS423 buffer page, which !BOOT loads over later):
#   CALL &900  the display (CRTC R8 &30) and cursor (R10 &20) off, the palette black, &3000-&7FFF
#              zeroed, and the vsync
#              event on, writing the ULA's MODE 1 value with the cursor off (&18, and the MOS's copy)
#              while MODE 1's mode change clears the screen (5 fields; its cursor is on until line 30)
#   CALL &94D  the event off, EVNTV back
#   CALL &96E  at the next vsync, the display on (R8 0: the MOS's MODE 1 value after *TV255,1)
# Line 30 keeps the display off while MSCREEN draws and the palette is set; line 70 shows it whole.
# Line 90's VDU 23 takes MODE 7's cursor off for the load, as line 30 does for the menu.
10 *TV255,1
20 *FX200,3
25 FORI%=0TO125:READB%:I%?&900=B%:NEXT:CALL&900
30 MODE1:VDU23;8202;0;0;0;23;12296;0;0;0;:CALL&94D
40 VDU19,1,0;0;19,2,0;0;19,3,0;0;
50 *RUN MSCREEN
60 VDU19,1,7;0;19,2,4;0;19,3,2;0;
65 CALL&96E
70 *FX15,1
80 REPEATA%=GET:UNTILA%=49ORA%=50ORA%=33ORA%=34
90 MODE7:VDU23;8202;0;0;0;
100 IFA%=49ORA%=33 OSCLI"DIR O" ELSE OSCLI"DIR R"
110 OSCLI"RUN !BOOT"
1000 DATA 169,8,141,0,254,169,48,141,1,254,169,10,141,0,254,169,32,141,1,254,169,7,141,33
1010 DATA 254,24,105,16,144,248,169,48,133,113,169,0,133,112,168,145,112,200,208,251,230,113,16,247
1020 DATA 173,32,2,141,108,9,173,33,2,141,109,9,169,97,141,32,2,169,9,141,33,2,169,14
1030 DATA 162,4,76,244,255,169,13,162,4,32,244,255,173,108,9,141,32,2,173,109,9,141,33,2
1040 DATA 96,72,169,24,141,32,254,141,72,2,104,96,0,0,169,19,32,244,255,169,8,141,0,254
1050 DATA 169,0,141,1,254,96
