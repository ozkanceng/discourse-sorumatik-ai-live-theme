# Sorumatik AI Canlı Cevap — Discourse Tema Bileşeni (Theme Component)

Sorumatik forumunda web tarayıcısı (masaüstü ve mobil web) üzerinden açılan sorularda **Yapay Zeka (Gemini) çözümlerinin gerçek zamanlı olarak kelime kelime akmasını** sağlayan resmi Discourse tema bileşenidir.

---

## 🚀 Nasıl Çalışır?

1. Kullanıcı web üzerinden yeni bir soru konusu açtığında veya takip sorusu sorduğunda, `discourse-sorumatik-ocr` eklentisi soruyu sunucuda (Sidekiq) üretmeye başlar.
2. Bu tema bileşeni, Discourse'un yerleşik `MessageBus` altyapısı üzerinden `/sorumatik/ai-answer/:source_post_id` kanalına anında bağlanır.
3. Sorunun hemen altına şık ve modern bir **"Sorumatik AI Çözümü Yazıyor..."** kartı yerleştirir.
4. Üretilen metin ve KaTeX matematik formülleri canlı olarak akar.
5. Cevap tamamlandığında canlı kart yumuşakça kaybolur ve kalıcı bot cevabı konudaki yerini alır.

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
- `bot_avatar_url`: İsteğe bağlı özel bot avatar görseli linki.

---

## 📦 Gereksinimler

- Discourse 2.8.0 veya üzeri
- `discourse-sorumatik-ocr` sunucu eklentisi (Protokol 3)
