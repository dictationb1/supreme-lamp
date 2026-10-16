මාතෘකාව:
[readiness/high] RDP ආරම්භ කිරීමට පෙර සූදානම (Pre-launch Readiness Tracker)

ගැටලුව:
RDP සේවාව ක්‍රියාත්මක වීමට පෙර අවශ්‍ය රහස්‍ය දත්ත (secrets) සහ වින්‍යාසයන් (configurations) සකසා නොමැති වීම නිසා Workflow එක අසමත් වේ.

සාක්ෂි:
Run ID: 38882965315 (Windows RDP - Tailscale Mission Control - 6h ephemeral)
අසමත් වූ පියවර: F59 parallel pre-warm (Tailscale MSI + prebuilt binaries + PS parse) සහ F92 smoke.

තහවුරු නොවූ දේ:
TS_AUTHKEY, VNC_PASS සහ RENTRY_EDIT_PASSWORD යන අගයන් Github Secrets ලෙස යාවත්කාලීන කර තිබේද යන්න.

කළ යුතු පියවර:
1. අත්‍යවශ්‍ය Secrets (TS_AUTHKEY, VNC_PASS, RENTRY_EDIT_PASSWORD) සකසන්න.
2. අදාල Setup Guide (docs/mission-control/v4/SETUP-GUIDE-si.md) කියවා පියවර අනුගමනය කරන්න.
3. නැවතත් Workflow එක ක්‍රියාත්මක කර එය සාර්ථකව අවසන් වන්නේ දැයි පරීක්ෂා කරන්න.

සැකසුම් සහ සබැඳි:
* Github Secrets: https://github.com/dictationb1/supreme-lamp/settings/secrets/actions
* Setup Guide: docs/mission-control/v4/SETUP-GUIDE-si.md

වගකීම:
Operator (භාවිතා කරන්නා)

පෙර අවශ්‍යතා:
නැත.

සාර්ථකත්වය තහවුරු කිරීම:
Workflow එක සාර්ථකව ධාවනය වී, අදාල අතුරුමුහුණත (Mission Control Dashboard) දර්ශනය වීම.

RDP ආරම්භය අවහිර කරනවාද:
ඔව්. රහස්‍ය දත්ත නොමැතිව Tailscale සහ Web Desktop ක්‍රියාත්මක නොවේ.
