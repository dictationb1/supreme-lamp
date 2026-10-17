# Jules Verification Lab & Repair Bridge - සකස් කිරීමේ මාර්ගෝපදේශය (LAB SETUP GUIDE)

මෙම ලේඛනය මගින් `dictationb1/supreme-lamp` ගබඩාවේ Jules Verification Lab පරිසරය සහ Event-driven Repair Bridge එක සක්‍රීය කිරීමට අවශ්‍ය අනුමත පියවරයන් පැහැදිලි කරයි.

---

## 1. ආරක්ෂිත RDP / Tailscale Credentials (Protected Lab Credentials)

RDP සහ Live Integration පරීක්ෂණ සඳහා පහත Repository Secrets සකස් කළ යුතුය:
* **`TS_AUTHKEY`**: Tailscale Auth Key එක [Tailscale Admin Keys Settings](https://login.tailscale.com/admin/settings/keys) වෙතින් ලබා ගන්න (Reusable, Ephemeral, pre-authorized key එකක් භාවිතා කරන්න).
* **`VNC_PASS`**: Web Desktop සම්බන්ධතාවය සඳහා අවම වශයෙන් අකුරු 8ක මුරපදයක්.

👉 **සැකසීමට පිවිසෙන්න:** [GitHub Repo Actions Secrets Settings](https://github.com/dictationb1/supreme-lamp/settings/secrets/actions)

---

## 2. Jules Repair Bridge සක්‍රීය කිරීම (API Authentication)

RDP Failure සිදුවීමකදී Jules වෙත ස්වයංක්‍රීයව Repair Session එකක් යැවීමට:
* **`JULES_API_KEY`**: GitHub Repository Secrets වෙත `JULES_API_KEY` නමින් ඔබගේ Jules API Key එක එක් කරන්න.
* **`BRIDGE_ENABLED`**: Repair Bridge එක අක්‍රිය කිරීමට අවශ්‍ය නම්, Repository Variables හි `BRIDGE_ENABLED` = `false` ලෙස සකසන්න.

👉 **සැකසීමට පිවිසෙන්න:** [GitHub Repo Actions Secrets & Variables](https://github.com/dictationb1/supreme-lamp/settings/secrets/actions)

---

## 3. GitHub Actions & Pull Request Permissions

* GitHub Actions හට read/write permissions හිමි බව තහවුරු කරගන්න:
👉 **පිවිසෙන්න:** [GitHub Actions General Settings](https://github.com/dictationb1/supreme-lamp/settings/actions)
  - Workflow permissions: `Read and write permissions`
  - Allow GitHub Actions to create and approve pull requests: `Checked`

---

## 4. Differentiating Account & Credential Failures (දෝෂ වර්ගීකරණය)

| Error Code | Causal Reason (හේතුව) | Action Required (කළ යුතු පිළියම) |
|---|---|---|
| `ts-authkey-missing` | Secret එක නොමැත. | `TS_AUTHKEY` secret එක ඇතුලත් කරන්න. |
| `ts-authkey-invalid` | Key එක වැරදිය, කල් ඉකුත් වී ඇත හෝ ප්‍රතික්ෂේප වී ඇත. | [Tailscale Keys Settings](https://login.tailscale.com/admin/settings/keys) වෙතින් නව Reusable Auth Key එකක් ජනනය කර Update කරන්න. |
| `cert-capability-unavailable` | Tailscale account එකෙහි HTTPS Certificates අක්‍රීයයි. | [Tailscale DNS Settings](https://login.tailscale.com/admin/dns) වෙත ගොස් MagicDNS සහ HTTPS Certificates සක්‍රීය කරන්න. |
| `vnc-pass-missing` | VNC_PASS secret එක නොමැත. | `VNC_PASS` secret එක ඇතුලත් කරන්න. |
