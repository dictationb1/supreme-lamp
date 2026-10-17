# Tailscale HTTPS Certificates සක්‍රිය කිරීමේ මාර්ගෝපදේශය (Operator Action Required)

## 1. ගැටලුවේ විස්තරය (Observed Failure)
* **Workflow Run Link:** https://github.com/dictationb1/supreme-lamp/actions/runs/39008706818
* **Run Number:** 13 (Revision: `89f0f9ff18a49830d6c120e8239b3466384ec5bc`)
* **අසාර්ථක වූ පියවර:** `Bind tailnet LE cert to RDP-Tcp (U5b)`
* **ලැබුණු දෝෂය (Sanitized Error):** `getting certs for <fqdn>: your Tailscale account does not support getting TLS certs`

Tailscale ජාලයට සම්බන්ධ වීම (Enrollment/MagicDNS) සාර්ථක වූවද, අදාල Tailnet හි HTTPS Certificates ලබාගැනීමේ පහසුකම Tailscale Admin Console හි සක්‍රිය කර නොමැති බැවින් Let's Encrypt TLS සහතිකය ලබාගැනීමට නොහැකි වී ඇත.

---

## 2. Operator විසින් කළ යුතු ක්‍රියාමාර්ග (Action Required)

1. **Tailscale Admin Console එකට පිවිසෙන්න:**
   [https://login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns) වෙත යන්න.

2. **නිවැරදි Tailnet එක තෝරාගන්න:**
   ඉහළ වම් කෙළවරෙන් ඔබගේ නිවැරදි Tailnet නාමය තෝරාගෙන ඇත්දැයි තහවුරු කරගන්න.

3. **HTTPS Certificates සක්‍රිය කරන්න:**
   * **DNS** ටැබ් එක යටතේ **HTTPS Certificates** කොටස වෙත යන්න.
   * **Enable HTTPS** බොත්තම ක්ලික් කරන්න.

4. **Public Ledger (Certificate Transparency) දැනුම්දීම:**
   * HTTPS Certificates සක්‍රිය කිරීමේදී, Let's Encrypt මගින් නිකුත් කරන TLS සහතිකයන්හි FQDN නාමය (උදා: `ghrdp-xxxx.ts.net`) Certificate Transparency (CT) නැමැති මහජන ලේඛනයෙහි (Public Ledger) සටහන් වන බවට වන දැනුම්දීම තහවුරු (Acknowledge) කරන්න.
   * මෙය සාමාන්‍ය Web TLS Certificate ක්‍රියාවලිය වන අතර Tailscale Security / Access restrictions සඳහා කිසිදු බලපෑමක් සිදු නොවේ.

---

## 3. වෙනස්කම් සිදුකිරීමෙන් පසු තහවුරු කිරීම (Verification After Change)
Admin Console හි HTTPS Certificates සක්‍රිය කිරීමෙන් පසු:
* GitHub Actions හි `main` branch එකෙහි Workflow එක re-dispatch (`mode=rdp`) කරන්න.
* `Bind tailnet LE cert to RDP-Tcp (U5b)` පියවර මගින් Let's Encrypt සහතිකය සාර්ථකව ලබාගෙන RDP-Tcp listener එක වෙත Bind වන බව (`certBound: true`) තහවුරු වනු ඇත.
