# RDP ආරම්භ කිරීමට පෙර (Pre-Launch Setup Guide)

මෙම ව්‍යාපෘතිය (v4 Mission Control) ක්‍රියාත්මක කිරීමට පෙර පහත සඳහන් රහස්‍ය දත්ත (secrets) Github ගබඩාවේ නිවැරදිව පිහිටුවා තිබිය යුතුය.

## 1. අත්‍යවශ්‍ය සැකසුම් (Required Configuration)

### TS_AUTHKEY
* **ගැටලුව:** Tailscale ජාලයට සේවාදායකය සම්බන්ධ කිරීමට අවශ්‍ය Auth Key එක නොමැත.
* **කළ යුතු පියවර:**
  1. Tailscale Admin Console හි (https://login.tailscale.com/admin/settings/keys) නව Auth Key එකක් නිර්මාණය කරන්න. (Reusable, Ephemeral, Pre-approved ලෙස සකසන්න).
  2. Github ගබඩාවේ [Settings > Secrets and variables > Actions](https://github.com/dictationb1/supreme-lamp/settings/secrets/actions) වෙත යන්න.
  3. `New repository secret` ක්ලික් කර, නම `TS_AUTHKEY` ලෙසත්, අගය ඔබ නිර්මාණය කළ Auth Key එක ලෙසත් ලබා දී සේව් කරන්න.
* **වගකීම:** Operator

### VNC_PASS
* **ගැටලුව:** Web Desktop (noVNC/TightVNC) සේවාව සඳහා මුරපදය සකසා නොමැත.
* **කළ යුතු පියවර:**
  1. අවම වශයෙන් අක්ෂර 8 කින් යුත් ශක්තිමත් මුරපදයක් නිර්මාණය කරන්න.
  2. Github ගබඩාවේ [Settings > Secrets and variables > Actions](https://github.com/dictationb1/supreme-lamp/settings/secrets/actions) වෙත යන්න.
  3. `New repository secret` ක්ලික් කර, නම `VNC_PASS` ලෙසත්, අගය ඔබ නිර්මාණය කළ මුරපදය ලෙසත් ලබා දී සේව් කරන්න.
* **වගකීම:** Operator

### RENTRY_EDIT_PASSWORD
* **ගැටලුව:** Mirror mode සක්‍රීය නම් Rentry පිටුව යාවත්කාලීන කිරීමට අවශ්‍ය මුරපදය නොමැත. (Fail-fast අදියරේදී පරීක්ෂා කෙරේ).
* **කළ යුතු පියවර:**
  1. Github ගබඩාවේ [Settings > Secrets and variables > Actions](https://github.com/dictationb1/supreme-lamp/settings/secrets/actions) වෙත යන්න.
  2. `New repository secret` ක්ලික් කර, නම `RENTRY_EDIT_PASSWORD` ලෙසත්, අගය ලෙස අදාල rentry edit code එක ලබා දී සේව් කරන්න.
* **වගකීම:** Operator

## 2. විකල්ප සැකසුම් (Optional Configuration)

* **TS_API_KEY / TS_TAILNET_NAME:** Tailscale Funnel සහ MagicDNS සක්‍රීය කිරීමට (Web Desktop/Dashboard පොදු අන්තර්ජාලයට විවෘත කිරීමට).
* **RENTRY_EDIT_COOKIE:** Rentry පිටුව සංස්කරණය සඳහා විකල්ප ක්‍රමයක් ලෙස.

## 3. ආරම්භ කිරීමට පෙර තහවුරු කිරීම (Pre-flight Checks)
* ඉහත අත්‍යවශ්‍ය Secrets නිසි පරිදි සකසා ඇති බව තහවුරු කරගන්න.
* PR අංක 1 (v4 Liquid Glass) දැනටමත් Merge වී හෝ ප්‍රධාන ශාඛාවේ (main) අදාල කේත වෙනස්කම් ඇති බව තහවුරු කරගන්න.
