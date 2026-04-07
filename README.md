# 🚌 OtobüsDenizli — Akıllı Şehir İçi Rota Asistanı

OtobüsDenizli, Denizli içi toplu ulaşımda alternatif bir arayüz ve rota motoru sunan açık kaynaklı bir "Case Study" uygulamasıdır. Kullanıcıların bekleme sürelerini saniyesi saniyesine azaltmak, karmaşık rotaları sadeleştirmek ve en hızlı ulaşım alternatiflerini bulabilmek amacıyla geliştirilmiştir.

![OtobüsDenizli Arayüz](/public/og-image.png)

## 📌 Özellikler
- **Kapıdan Kapıya Rota Planlama:** Sadece duraklar arasında değil; bulunduğunuz konumdan (veya seçilen adresten) varış noktasına kadar yürüme mesafeleri ve aktarma sürelerini içeren tam navigasyon.
- **Gerçek Zamanlı Çözümleme (Canlı Radar):** Arka planda anlık olarak otobüslerin durağa kalan mesafeleri ve tahmini varış süreleri hesaplanır.
- **Zaman Makinesi (Aktarma Senkronu):** Aktarmalı rotalarda, ilk otobüsten indiğinizde ikinci otobüsü kaçırıp kaçırmayacağınızı hesaplayan akıllı algoritma.
- **PWA (Progressive Web App):** Uygulamayı tarayıcı üzerinden telefonunuza ikon olarak ekleyebilir, native bir uygulama gibi kullanabilirsiniz.
- **Tam i18n Desteği:** Tek tıkla Türkçe ve İngilizce dil seçeneği (Turistler ve yabancı öğrenciler için optimize edilmiştir).
- **Favori Konumlar:** Sadece durakları değil; "Evim, İşim, Okul" gibi spesifik lokasyonları kaydedip tek tıkla rota bulabilme.
- **Karanlık Tema & Modern UI:** Mobil odaklı, göz yormayan ve iOS/Android standartlarına uygun arayüz.
- **Offline / Hata Toleransı:** Temel dosyaların (`sw.js`) önbelleğe alınması sayesinde internet dalgalanmalarında bile hızlı açılış.

## 🛠️ Mimari ve Teknolojiler
Bu proje modern web mimarileri üzerine inşa edilmiştir:
- **Client (İstemci):** Vanilla JS + HTML5 + CSS3 (Sıfır ek yük, limitsiz performans). 
- **Build Tool:** Vite ⚡
- **Haritacılık:** Leaflet.js & OpenStreetMap (OSM) Veritabanı
- **Backend & Proxy API:** Cloudflare Workers (CORS ve Payload Optimizasyonları)

## 📁 Proje Yapısı
```bash
.
├── src/
│   ├── api/             # API Wrapper, i18n ve Rota Motoru
│   ├── css/             # Tema ve Global Stiller
│   └── main.js          # Uygulama ve UI Mantığı
├── public/              # PWA Assetleri, Manifest ve Service Worker
├── index.html           # Ana Giriş ve Layout
└── vite.config.js       # Build Ayarları
```

## 🚀 Yerel Kurulum (Development)
Projeyi kendi bilgisayarınızda çalıştırmak için:

1. Depoyu klonlayın:
   ```bash
   git clone https://github.com/cagdast39/otobusdenizli.git
   ```
2. Gerekli bağımlılıkları yükleyin:
   ```bash
   npm install
   ```
3. `.env` dosyasını oluşturun ve gerekli anahtarları ekleyin:
   ```env
   VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key
   VITE_API_DENIZLI_BASE=https://your-worker-proxy.dev/denizli
   VITE_API_GOOGLE_BASE=https://your-worker-proxy.dev/google/maps/api/place/autocomplete/json
   ```
4. Geliştirme sunucusunu başlatın:
   ```bash
   npm run dev
   ```
5. Tarayıcınızda `http://localhost:5173` adresine gidin.

## 📜 Lisans
Bu proje **MIT Lisansı** ile lisanslanmıştır. Detaylar için `LICENSE` dosyasına bakabilirsiniz. (Veya: "Açık kaynak kodu eğitim ve toplumsal fayda amacıyla dilediğiniz gibi kullanabilirsiniz.")

## 🛣️ API ve Endpointler (Denizli Ulaşım)
Denizli Büyükşehir Belediyesi'nin ulaşım sistemi için açık bir resmî API dokümantasyonu bulunmadığı için sistem, `ulasim.denizli.bel.tr` ağı üzerindeki trafiğin haritalandırılmasıyla oluşturulmuştur. Direkt iletişim CORS Preflight limitlerine takıldığı için tüm sorgular aracı Cloudflare Worker (`otobusdenizli-api.cagdaspronebeklion.workers.dev`) üzerinden geçmektedir.

| Kullanılan API Endpoint | İşlev | 
|-------------------------|-------|
| `/api/Calc/GetAllStations` | Tüm aktif durakların ve koordinatların taranması |
| `/api/Calc/GetRouteStations` | Belirli bir hattın durak diziliminin alınması |
| `/api/Calc/GetAllRoutes` | Mevcut otobüs hatlarının indekslenmesi |
| `/api/Calc/GetBusDataForStation` | **Canlı Radar:** O an durağa gelmekte olan araçların canlı GPS verisi |

---

## ⚖️ Feragatname ve Yasal Uyarı (Disclaimer)
- Bu yazılım geliştiricinin tamamen bireysel kapasitesini test etme ve Açık Kaynak Topluluğuna katkı vizyonuyla oluşturulmuş bir **AR-GE Portfolyo Projesidir**.
- **Ticari hiçbir amacı, garantisi veya hedefi yoktur.** Barındırdığı veriler açık internet protokolleri üzerinden Denizli yetkili ağlarına okuma mantığı ile bağlanır. Verilerin doğruluk sorumluluğu veya ulaşım operasyonlarının hiçbir aşaması bu uygulamanın yükümlülüğünde değildir.
- Uygulamanın, sunuculara yük bindirmemesi için sistem içi özel statik gecikmeli önbellek (In-Memory Cache) tasarlanmıştır.

> Resmî duyurular, anlık gecikmeler ve resmi tablolar için yegane ana mercii **[Denizli Ulaşım Portalı](https://ulasim.denizli.bel.tr)'dır**. 

## 🤝 Katkıda Bulunanlar ve Teşekkür (Credits)
Projenin API navigasyonu ve veri mimarisini haritalandırma noktasında Denizli yazılımcı topluluğuna büyük bir vizyon sunan GitHub kullanıcısı **[@umutcandev](https://github.com/umutcandev)**'e ([denizli-ulasim-durak](https://github.com/umutcandev/denizli-ulasim-durak)) teşekkür ederiz.
