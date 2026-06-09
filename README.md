# ✈️ PilotReady

**Twój cyfrowy instruktor do egzaminu teoretycznego PPL(A).**

PilotReady to aplikacja webowa, która pomaga przyszłym pilotom przygotować się
do egzaminu na licencję turystyczną samolotową (PPL(A)) przed Urzędem Lotnictwa
Cywilnego. Cały oficjalny bank **2053 pytań** masz w jednym miejscu — możesz się
spokojnie uczyć przedmiot po przedmiocie, a kiedy poczujesz się gotowy,
podejść do **pełnej symulacji egzaminu ULC** w warunkach jak najbardziej
zbliżonych do prawdziwych: z zegarem, limitami czasu i progiem zaliczenia.

> Żadnego ściągania PDF-ów, żadnego liczenia punktów na kartce. Klikasz, uczysz
> się, sprawdzasz, gdzie popełniasz błędy — i wracasz na lotnisko lepiej
> przygotowany. 🛩️

---

## ✨ Co potrafi PilotReady

### 📚 Tryb nauki
- **9 przedmiotów** PPL(A), każdy z własną pulą pytań z oficjalnego banku.
- Pasek postępu pokazuje, ile pytań w danym przedmiocie masz już przerobione.
- Odpowiedzi są **tasowane przy każdym wyświetleniu** — uczysz się treści, a nie
  pozycji „zawsze A".
- Twój postęp zapisuje się automatycznie (lokalnie i po stronie konta).

### 📝 Symulacja egzaminu ULC
Wierne odwzorowanie prawdziwego egzaminu teoretycznego:

| Przedmiot | Pytań | Czas |
|---|:--:|:--:|
| Prawo lotnicze | 16 | 25 min |
| Ogólna wiedza o samolocie | 12 | 20 min |
| Osiągi i planowanie lotu | 12 | 20 min |
| Człowiek – możliwości | 12 | 25 min |
| Meteorologia | 16 | 30 min |
| Nawigacja | 16 | 45 min |
| Procedury operacyjne | 12 | 20 min |
| Zasady lotu | 12 | 25 min |
| Łączność | 12 | 20 min |
| **Razem** | **120** | **230 min** |

- ⏱️ **Surowy zegar odliczający** — robi się żółty na 5 minut przed końcem,
  pulsuje na czerwono na ostatniej minucie i **automatycznie kończy egzamin**,
  gdy czas się skończy.
- 🤫 **Bez podpowiedzi w trakcie** — zaznaczona odpowiedź jest neutralna, nigdy
  nie zobaczysz „zielone/czerwone" przed oddaniem egzaminu (tak jak na prawdziwym).
- 🗂️ **Arkusz przeglądu (sidebar)** — w każdej chwili widzisz, na które pytania
  już odpowiedziałeś, a które pominąłeś, i jednym kliknięciem do nich wracasz.
- ✅ **Próg zaliczenia 75% w każdym przedmiocie** — jak w ULC: nie wystarczy
  dobra średnia, trzeba zaliczyć każdy przedmiot osobno.
- 🔍 **Przegląd po egzaminie** — pokazuje dokładnie, które pytania poszły źle lub
  zostały pominięte, jaką odpowiedź wybrałeś i jaka była poprawna. Z filtrem
  „tylko błędne / wszystkie".

---

## 🧱 Jak to jest zbudowane

| Warstwa | Technologie |
|---|---|
| **Frontend** | React + TypeScript + Vite, stylowanie Tailwind CSS (ciemny motyw) |
| **Backend** | FastAPI + SQLAlchemy (Python) |
| **Baza danych** | PostgreSQL (lokalnie lub w chmurze, np. [Neon](https://neon.tech)) |
| **Dane** | Parser PDF oparty na pdfminer, wyciągający 2053 pytania z oficjalnego źródła |

Mała, ale ważna zasada projektowa: w bazie **poprawna odpowiedź zawsze siedzi pod
kluczem `A`** (źródło trzyma ją w kolumnie `ODP1`). Tasowanie odbywa się dopiero
przy wysyłce do przeglądarki, więc „prawda źródłowa" nigdy się nie psuje, a mimo
to żaden użytkownik nie zgadnie odpowiedzi po jej pozycji.

```
PilotReady/
├── backend/
│   ├── main.py        # API: kategorie, pytania, postęp nauki
│   ├── exam.py        # API egzaminu: /api/exam/start i /api/exam/submit
│   ├── database.py    # konfiguracja bazy (czyta .env)
│   └── models.py      # modele SQLAlchemy
├── scripts/
│   ├── parse_ppla_pdf.py   # PDF → data/questions.json
│   └── seed_db.py          # questions.json → baza
├── src/
│   ├── App.tsx             # panel z przedmiotami + wejście do egzaminu
│   └── components/
│       ├── QuestionView.tsx  # tryb nauki
│       └── ExamView.tsx      # sala egzaminacyjna + przegląd wyników
├── database/schema.sql
└── ppla.pdf                # oficjalne źródło pytań (import jednorazowy)
```

---

## 🚀 Jak uruchomić u siebie

### Czego potrzebujesz
- **Python 3.11+**
- **Node.js 18+** (do frontendu)
- **PostgreSQL** — własny lokalny albo darmowa baza w chmurze (np. Neon —
  zakładasz projekt, kopiujesz connection string i gotowe).

### 1. Backend i dane

```bash
# zależności Pythona
python -m pip install -r requirements.txt

# konfiguracja połączenia z bazą
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
# ...i wpisz swój DATABASE_URL w pliku .env

# wyciągnij pytania z PDF do data/questions.json
python scripts/parse_ppla_pdf.py --input ppla.pdf --output data/questions.json --pretty

# wgraj pytania do bazy (utworzy tabele i zaseeduje 2053 pytania)
python scripts/seed_db.py

# odpal API
python -m uvicorn backend.main:app --reload
```

Backend wystartuje na `http://127.0.0.1:8000`, a interaktywna dokumentacja API
czeka pod `http://127.0.0.1:8000/docs`.

### 2. Frontend

```bash
npm install
npm run dev
```

Otwórz **http://localhost:5173** — gotowe! Vite automatycznie przekierowuje
zapytania `/api` do backendu, więc nie musisz nic dodatkowo konfigurować.

---

## ⚙️ Konfiguracja (`.env`)

```bash
# Połączenie z bazą — wskaż SWOJĄ bazę (tę, którą widzisz np. w pgAdmin/Neon)
DATABASE_URL=postgresql://user:haslo@host:5432/nazwa_bazy

# Skąd frontend może odpytywać API (dev server Vite stoi na 5173)
CORS_ORIGINS=http://localhost:5173
```

Plik `.env` jest w `.gitignore` — **Twoje hasło nigdy nie trafi do repozytorium.**
W repo leży tylko `.env.example` jako szablon.

---

## 🩺 Drobne potknięcia (troubleshooting)

- **`npm install` / `git push` zgłasza błąd certyfikatu SSL?**
  Niektóre antywirusy i firewalle firmowe „prześwietlają" ruch HTTPS, przez co
  npm i git nie ufają certyfikatowi. Najprościej:
  ```bash
  NODE_OPTIONS=--use-system-ca npm install     # npm korzysta z magazynu certów Windows
  git -c http.sslBackend=schannel push         # git korzysta z natywnego Windows
  ```
- **`DATABASE_URL is required`?** Nie masz pliku `.env` albo nie ustawiłeś w nim
  połączenia. Skopiuj `.env.example` → `.env` i uzupełnij.
- **Egzamin „nie ma pytań"?** Najpierw odpal `seed_db.py` — baza musi być
  wypełniona.

---

## 🗺️ Co dalej (pomysły na rozwój)

- Konta użytkowników i logowanie (model już czeka w bazie).
- Historia podejść do egzaminu i statystyki słabych punktów.
- Skok z błędnego pytania prosto do nauki danego przedmiotu.
- Wersja mobilna / PWA do nauki w terenie.

---

## 📄 Licencja

Projekt na licencji **MIT** — patrz [LICENSE](LICENSE).

---

<p align="center"><em>Miękkich lądowań i zdanego egzaminu! 🛬</em></p>
