මාතෘකාව:
[config/high] Web Desktop මුරපදය සැකසීම (VNC_PASS)

ගැටලුව:
Web Desktop (noVNC/TightVNC) සඳහා අවශ්‍ය මුරපදය නොමැති වීම නිසා `Web desktop` අදාල පියවරයන් අසමත් වේ.

සාක්ෂි:
Run ID: 38882965315 හි කේතයට අනුව `VNC_PASS` නොමැති විට එය fail-closed වේ.

තහවුරු නොවූ දේ:
නැත.

කළ යුතු පියවර:
1. ශක්තිමත් මුරපදයක් (අවම වශයෙන් අකුරු 8ක්) සාදන්න.
2. Github හි [Settings > Secrets and variables > Actions](https://github.com/dictationb1/supreme-lamp/settings/secrets/actions) වෙත ගොස් `VNC_PASS` නමින් එය සේව් කරන්න.
3. නැවත Workflow එක ක්‍රියාත්මක කරන්න.

සැකසුම් සහ සබැඳි:
* Github Secrets: https://github.com/dictationb1/supreme-lamp/settings/secrets/actions

වගකීම:
Operator

පෙර අවශ්‍යතා:
නැත.

සාර්ථකත්වය තහවුරු කිරීම:
Workflow හි `Web desktop` අදාල පියවරයන් සාර්ථක වීම සහ Web Desktop වෙත පිවිසීමට හැකි වීම.

RDP ආරම්භය අවහිර කරනවාද:
ඔව්, Web Desktop සේවාව අත්‍යවශ්‍ය නම් මෙය අවහිර කරයි.
