# Arhitectură

```
Browser (Next.js client)                Vercel (Route Handlers, Node)            Supabase
------------------------                -----------------------------            --------
fetch /api/rooms/...  ───────────────▶  validare + logică de joc   ──service──▶  Postgres (RLS on,
  header x-player-token                 (service role key)                        fără policies)
                                              │
                                              └── httpSend("refresh") ─────────▶  Realtime Broadcast
supabase.channel("xand0:<id>") ◀─────────────────────────────────────────────────── topic xand0:<roomId>
  la orice eveniment → refetch GET /api/rooms/<code>/state
```

## Decizii

1. **Același proiect Supabase ca Bingo**, tabele cu prefix `xand0_` și topic Realtime `xand0:<uuid>`.
   Nimic nu se suprapune cu Bingo.
2. **Realtime prin Broadcast, nu Postgres Changes** (clientul anonim nu are acces RLS). Evenimentele sunt doar semnale
   `{ kind }`, clientul face refetch autentificat. Polling la 15 s ca rezervă.
3. **Identitate = token aleator** (32 bytes) în `localStorage`; DB-ul păstrează doar SHA-256.
4. **Parola camerei** = hash `scrypt` cu salt, verificată cu `timingSafeEqual`.
5. **Tabla** e un string de 9 caractere (`.`, `X`, `O`) în `xand0_rooms.board`. Tura se deduce din numărul de semne:
   X mută când X și O au același număr.
6. **Concurență:** `xand0_rooms.version` crește la fiecare mutare / schimbare de locuri. Update-urile au
   `WHERE version = <citit>`, deci din două mutări simultane trece una, cealaltă primește 409.
7. **Locuri:** `x_player_id` / `o_player_id`. Oricine altcineva e spectator. Cât camera e `waiting`, locurile goale se
   umplu în ordinea intrării (`settleSeats`) și runda pornește când ambele sunt ocupate. În `playing` / `finished`
   locurile nu se mută. La runda nouă jucătorii schimbă X cu O, iar un loc gol îl ia primul spectator.

## Fluxul stărilor

`waiting` → (ambele locuri ocupate) → `playing` → (3 în linie, remiză sau plecarea unui jucător) → `finished`
→ (jucător sau host: rundă nouă) → `playing`, sau `waiting` dacă nu mai sunt 2 jucători.

## API (toate sub `/api/rooms`)

| Metodă | Rută | Cine | Ce face |
| --- | --- | --- | --- |
| GET | `/api/rooms` | oricine | camerele care mai au loc |
| POST | `/api/rooms` | oricine | creează camera, creatorul ia X |
| POST | `/[code]/join` | oricine | intră: jucător dacă e loc liber, altfel spectator (max 4) |
| GET | `/[code]/state` | membru | starea camerei (heartbeat de prezență) |
| POST | `/[code]/move` | jucătorul la tură | `{ cell: 0..8 }` |
| POST | `/[code]/new-round` | jucător sau host, `finished` | rundă nouă, X ↔ O |
| POST | `/[code]/leave` | membru | pleacă; în timpul rundei adversarul câștigă |
| POST | `/[code]/kick` | host | scoate pe cineva |
