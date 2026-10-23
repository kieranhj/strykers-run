# menu.bas - the release disc's MENU (tools/releasedisc.py tokenises it; lines starting # are dropped).
# The original release's MENU (reference/sth/StrykersRun.ssd), lines 110-180, with its choices
# changed: 1 the original game, faster (directory O), 2 Redux (directory R), each started by its
# own !BOOT (the machine check, the build stamp, *TV255,1, *FX200,3, *RUN SRRUN).
10 *TV255,1
20 *FX200,3
30 MODE1:VDU23;8202;0;0;0;
40 VDU19,1,0;0;19,2,0;0;19,3,0;0;
50 *RUN MSCREEN
60 VDU19,1,7;0;19,2,4;0;19,3,2;0;
70 *FX15,1
80 REPEATA%=GET:UNTILA%=49ORA%=50ORA%=33ORA%=34
90 MODE7
100 IFA%=49ORA%=33 OSCLI"DIR O" ELSE OSCLI"DIR R"
110 OSCLI"RUN !BOOT"
