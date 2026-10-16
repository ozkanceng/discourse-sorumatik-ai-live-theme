# Sorumatik AI Canlı Cevap & Mobil Uygulama — Discourse Tema Bileşeni

Sorumatik forumunda web tarayıcısı (masaüstü ve mobil web) üzerinden açılan sorularda **Yapay Zeka (Gemini) çözümlerinin gerçek zamanlı olarak kelime kelime akmasını** ve **Sorumatik mobil uygulamasının tanıtımını** sağlayan resmi Discourse tema bileşenidir.

---

## 🚀 Öne Çıkan Özellikler

1. **Canlı Akış (MessageBus):** Kullanıcı webden bir soru açtığında, sunucuda üretilen çözüm adımları daktilo efekti ve KaTeX matematik formülleriyle canlı olarak ekranda akar.
2. **sorumatik.co Marka İmzası:** Kartın altında şık `⚡ sorumatik.co Yapay Zeka Motoru` etiketiyle platform güvenini pekiştirir.
3. **Mobil Uygulamaya Dönüşüm Rozeti:** Çözüm kartının altında `📱 Sorumatik Uygulamasını İndir` butonu yer alır. Tıklandığında doğrudan `https://sorumatik.co/t/app` yönlendirme sayfasına veya mağaza linklerine yönlendirir.
4. **Sorunsuz Geçiş:** Sunucu cevabı tamamlayıp postu Discourse veritabanına kaydettiğinde canlı kart yumuşakça kaybolur ve kalıcı bot cevabı konudaki yerini alır.

---

## 🛠 Kurulum

### Yöntem 1: Git ile Kurulum (Önerilen)
1. Discourse Yönetici Paneline gidin: **Yönetici (Admin) > Özelleştir (Customize) > Temalar (Themes)**.
2. **Bileşenler (Components)** sekmesine geçin ve **Yükle (Install)** butonuna tıklayın.
3. **Bir git deposundan (From a git repository)** seçeneğini seçin.
4. Bu temanın GitHub depo URL'sini yapıştırın ve **Yükle** deyin.
5. Bileşeni sitenizde aktif olan varsayılan temanıza / temalarınıza ekleyin (örneğin *Sorumatik Ana Tema* veya *Tüm Temalar*).

### Yöntem 2: Arşiv (ZIP) ile Kurulum
1. Bu klasörü zip formatında sıkıştırın.
2. Discourse Admin panelinden **Bir dosyadan (From a device/file)** diyerek zip dosyasını yükleyin.

---

## ⚙️ Yapılandırma Seçenekleri (Settings)

Tema bileşeni ayarlarından dilediğiniz gibi özelleştirebilirsiniz:

- `bot_username`: Cevabı yazan botun kullanıcı adı (Varsayılan: `sorumatik_ai`).
- `card_title`: Canlı kartın başlığı (Varsayılan: `Sorumatik AI Çözümü Yazıyor...`).
- `show_pulse_indicator`: Yeşil canlı yayın nabız noktasını göster / gizle (Varsayılan: `true`).
- `show_branding`: `sorumatik.co` marka etiketini göster / gizle (Varsayılan: `true`).
- `branding_url`: Marka tıklandığında gidilecek adres (Varsayılan: `https://sorumatik.co`).
- `branding_text`: Marka metni (Varsayılan: `sorumatik.co Yapay Zeka Motoru`).
- `show_app_download`: Uygulama indirme butonunu göster / gizle (Varsayılan: `true`).
- `app_landing_url`: İndirme yönlendirme linki (Varsayılan: `https://sorumatik.co/t/app`).
- `use_direct_store_links`: Yönlendirme sayfası yerine doğrudan Android & iOS butonlarını ayrı göster (Varsayılan: `false`).
- `android_store_url`: Google Play Store indirme linki.
- `ios_store_url`: Apple App Store indirme linki.

---

## 📦 Gereksinimler

- Discourse 2.8.0 veya üzeri
- `discourse-sorumatik-ocr` sunucu eklentisi (Protokol 3)
