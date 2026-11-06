# webXsi0Game

X și 0 clasic (3×3), jucat cu un prieten, pe telefon. Încă 2 prieteni pot intra în cameră ca spectatori.
Next.js 16 (App Router), Supabase (Postgres + Realtime Broadcast), deploy pe Vercel. Aceeași arhitectură ca
[webBingoGame](https://github.com/florin2495/webBingoGame).

## Reguli

1. Creatorul camerei (host-ul) primește **X**. Camera poate avea parolă (opțional).
2. Al doilea care intră primește **0** și runda pornește imediat. X mută primul.
3. Câștigă cine face primul 3 în linie (rând, coloană, diagonală). Tabla plină fără linie = remiză.
4. **Spectatori:** jucătorii 3 și 4 pot intra oricând, și în timpul unei runde. Văd tabla live, scorul și a cui e tura,
   dar nu pot muta. Camera are maxim 4 oameni.
5. **Rundă nouă:** după final, oricare dintre jucători (sau host-ul) pornește runda următoare. Jucătorii schimbă X cu 0,
   deci începe celălalt. Scorul (victorii și remize) se păstrează cât stați în cameră.

### Extra

- **Plecare:** dacă un jucător pleacă în timpul rundei, adversarul câștigă runda. Locul liber îl ia primul spectator
  (în ordinea intrării) la runda următoare. Dacă pleacă host-ul, devine host următorul din cameră.
  Când pleacă ultimul, camera se închide.
- **Kick:** host-ul poate scoate pe oricine. Nu e ban, parola camerei e protecția reală.
- **Lista de camere:** în „Intră în cameră” vezi camerele care mai au loc, cu „Joacă” (loc liber) sau „Privește”.
- **Închidere automată:** o cameră care așteaptă sau e între runde se închide după 2 minute în care nimeni nu o mai are
  deschisă. O rundă în desfășurare se închide după 30 de minute fără nimeni.
- **Sunete:** un semnal când vine tura ta și la finalul rundei (se pot opri din Setări).

## Arhitectură, pe scurt

- Toată logica rulează în Route Handlers (`src/app/api/rooms/...`) cu **service role key**, doar pe server.
- Tabelele (`xo_rooms`, `xo_players`) au **RLS activat și nicio policy**, plus `revoke` pentru `anon`/`authenticated`.
- Live: după fiecare modificare, serverul trimite un semnal **Supabase Realtime Broadcast** pe topicul `xo:<uuid>`.
  Clientul face refetch la `/api/rooms/<cod>/state`. Polling la 15 s ca rezervă.
- Mutările sunt protejate de o coloană `version`: din două mutări simultane trece doar una.

Detalii: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Schema: [supabase/schema.sql](supabase/schema.sql).

## Setup

### 1. Supabase

Jocul folosește **același proiect Supabase ca Bingo**. Tabelele au prefixul `xo_`, deci nu se ating de Bingo.

1. **SQL Editor → New query**: lipește tot conținutul din `supabase/schema.sql` și rulează.
2. Cheile sunt aceleași ca la Bingo (vezi `.env.example`).

Pentru un proiect Supabase separat: creează-l, rulează `schema.sql`, și la **Realtime → Settings** lasă activat
*Allow public access* (canalele Broadcast sunt publice).

### 2. Local

```bash
npm install
cp .env.example .env.local   # completează cele 3 valori
npm run dev                  # http://localhost:3000
npm test                     # testele regulilor de joc
```

### 3. Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import** `florin2495/webXsi0Game`.
2. **Settings → Environment Variables**: cele 3 variabile din `.env.example`, pentru Production (și Preview, dacă vrei).
3. **Redeploy** după ce adaugi variabilele: `NEXT_PUBLIC_*` intră în bundle la build.
4. **Settings → Domains → Add Existing** → `xsi0.hailatat.icu`.
5. Fiecare push pe `main` face deploy automat.

## Limitări cunoscute

- Identitatea e un token în `localStorage`. Dacă îl ștergi sau schimbi browserul, intri din nou ca membru nou.
- Nu există rate limiting.
