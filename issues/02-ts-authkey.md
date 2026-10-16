මාතෘකාව:
[config/high] Tailscale Auth Key එකතු කිරීම (TS_AUTHKEY)

ගැටලුව:
Tailscale ජාලයට සම්බන්ධ වීමට අවශ්‍ය TS_AUTHKEY සකසා නොමැති වීම නිසා RDP සේවාදායකය අන්තර්ජාලයට සම්බන්ධ නොවේ. මේ නිසා Tailscale up පියවර (Fail-closed) අසමත් වේ.

සාක්ෂි:
Run ID: 38882965315, `Tailscale up (TS_AUTHKEY fail-closed, halt-with-link)` පියවර මඟ හැරීම හෝ අසමත් වීම.

තහවුරු නොවූ දේ:
නැත (මෙය අනිවාර්යය වේ).

කළ යුතු පියවර:
1. Tailscale Admin Console (https://login.tailscale.com/admin/settings/keys) වෙතින් නව Auth Key එකක් ලබාගන්න.
2. Github හි [Settings > Secrets and variables > Actions](https://github.com/dictationb1/supreme-lamp/settings/secrets/actions) වෙත ගොස් `TS_AUTHKEY` නමින් එය සේව් කරන්න.
3. නැවත Workflow එක ක්‍රියාත්මක කරන්න.

සැකසුම් සහ සබැඳි:
* Github Secrets: https://github.com/dictationb1/supreme-lamp/settings/secrets/actions
* Tailscale Console: https://login.tailscale.com/admin/settings/keys

වගකීම:
Operator

පෙර අවශ්‍යතා:
Tailscale ගිණුමක් තිබීම.

සාර්ථකත්වය තහවුරු කිරීම:
Workflow හි `Tailscale up` පියවර සාර්ථක වීම සහ Tailscale IP ලිපිනයක් ලබා ගැනීම.

RDP ආරම්භය අවහිර කරනවාද:
ඔව්. Tailscale ජාලය නොමැතිව RDP සේවාවට පිවිසිය නොහැක.
