# Supreme Lamp - Mission Control

## RDP ආරම්භ කිරීමට පෙර (Pre-Launch Setup Guide)

**අවධානයයි:** අත්‍යවශ්‍ය රහස්‍ය දත්ත නොමැතිව Workflow එක ධාවනය කළහොත් එය අනිවාර්යයෙන්ම අසමත් වේ.

1. අත්‍යවශ්‍ය රහස්‍ය දත්ත (Secrets) සැකසීමේ ලැයිස්තුව විවෘත කර අවශ්‍ය වින්‍යාසයන් සම්පූර්ණ කරන්න: [SETUP-GUIDE-si.md](docs/mission-control/v4/SETUP-GUIDE-si.md).
2. තෝරාගත් අත්තෙහි (branch/ref) නියමිත workflow වෙනස්කම් ඇති බව තහවුරු කරගන්න. [MIGRATION-READINESS.md](docs/mission-control/v4/MIGRATION-READINESS.md) බලන්න.
3. අදාල GitHub Actions පිටුවට ගොස් (https://github.com/dictationb1/supreme-lamp/actions) workflow එක ධාවනය කරන්න. එහිදී පළමුව **mode=readiness** (පෙරනිමි) ලෙස තෝරා වින්‍යාසයන් පමණක් පරීක්ෂා කළ හැක.
4. Job summary එක කියවා, වින්‍යාසකරණ දෝෂ ඇත්නම් (Secrets) ඒවා නිවැරදි කරන්න. (Readiness mode එක කිසිදු සැබෑ RDP සැසියක් හෝ ස්වයංක්‍රීය Asset සූදානම් කිරීමක් සිදු නොකරයි).
5. **mode=rdp** තෝරාගෙන එකවර ධාවනය කරන්න (Single Dispatch). Workflow එක මගින් අවශ්‍ය සියලුම Dependencies (UI Bundle, F59 Prebuilt Binaries) ස්වයංක්‍රීයව පරීක්ෂා කර, නොමැති නම් ස්වයංක්‍රීයව සූදානම් කර RDP සැසිය ආරම්භ කරයි. F59 හෝ UI workflows වෙනම manual ධාවනය කිරීම අවශ්‍ය නොවේ!
6. Service-readiness summary එක දර්ශනය වන තෙක් සිටින්න. එය දර්ශනය වූ පසු පමණක් RDP වෙත සම්බන්ධ වීමට උත්සාහ කරන්න. (Workflow එක ධාවනය වීම පමණක් ඩෙස්ක්ටොප් එක සූදානම් බවක් අදහස් නොකරයි).
7. සම්බන්ධ වීම සඳහා ලේඛනගත කර ඇති ආරක්ෂිත ක්‍රමවේදය අනුගමනය කරන්න.

* **සැලකිය යුතුයි:** `readiness` මාදිලිය මගින් RDP ඩෙස්ක්ටොප් එකක් නිර්මාණය නොකරයි. එය පරීක්ෂා කරන්නේ වින්‍යාසයන් පමණි. `mode=rdp` මාදිලියේදී සියලුම dependencies ස්වයංක්‍රීයව සූදානම් කර, සේවාවන් සාර්ථකව ආරම්භ වූ පසු සම්පූර්ණ 5h30 keepalive ක්‍රියාවලිය ආරම්භ වේ.

වැඩි විස්තර සඳහා:
* [දෝෂ නිරාකරණය සහ Readiness ඊළඟ පියවර](NEXT-RUN-GUIDE-si.md)
