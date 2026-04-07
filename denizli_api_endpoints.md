# 🛣️ Denizli Ulaşım API Endpoints (Tersine Mühendislik)

Bu projenin rota motoru, Denizli Büyükşehir Belediyesi'nin resmî mobil uygulaması tarafından kullanılan gizli API uç noktalarının çözümlenmesiyle oluşturulmuştur. Tüm istekler CORS engellerini aşmak için özel bir Cloudflare Worker proxy'si üzerinden geçmektedir.

## 🔗 Temel Bilgiler
- **Resmî Kaynak:** `https://ulasim.denizli.bel.tr`
- **Modern Proxy:** `https://otobusdenizli-api.cagdaspronebeklion.workers.dev/denizli`

## 📊 Kullanılan Servisler

| Endpoint | Method | İşlev |
|:---------|:------:|:------|
| `/Calc/GetAllStations` | GET | Tüm durak listesi (Ad, ID, Konum) |
| `/Calc/GetAllRoutes` | GET | Aktif tüm hatlar (910, 300 vb.) |
| `/Calc/GetRouteStations?routeCode=X` | GET | X hattının geçtiği durakların sıralı listesi |
| `/Calc/GetBusDataForStation?waitingStation=X` | GET | X durağına yaklaşan otobüslerin canlı GPS ve süre verisi |
| `/Calc/SearchStationOrRoute?text=X` | GET | Durak ve hat araması |
| `/jsonovetotobuskonumlar.ashx?lineCode=X` | GET | X hattındaki aktif otobüslerin anlık koordinatları |
| `/jsonotobusduraklar.ashx` | GET | Hat bilgileri ve resmi JPEG saat tablosu linkleri |

---

## ⚠️ Önemli Not
Bu API uç noktaları Denizli Belediyesi'nin resmî dökümante edilmiş servisleri değildir. Sistem mimarisinde oluşabilecek herhangi bir değişiklikte rota motorunun güncellenmesi gerekebilir. Proje içindeki `src/api/denizli-api.js` bu servisler arasındaki iletişimi yönetir.
