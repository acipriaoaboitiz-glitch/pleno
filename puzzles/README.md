# Daily football puzzles

The scheduled workflow builds its candidate catalog from Wikidata's public
SPARQL endpoint and publishes a 60-day reserve directly to Supabase. It does
not require a hand-uploaded `catalog.json`; `catalog.example.json` is only a
schema example and must not be used as production data.

Wikidata entity IDs (`Q...`) are used as answer identities and source
references. Wikidata data is CC0. The generator uses player-to-club
membership records for LaLiga clubs and complete player attributes, then
validates puzzle structure and uniqueness before publishing. Wikidata is community-maintained, so
automated checks cannot independently verify every underlying claim or judge
wording. The workflow does not use copied biographies, photos, or scraped prose.
The top-level `entities` array contains `{id, name, attributes}` records used
to display answer choices and compare verified player attributes. Names and
attributes are stored privately; clients receive display names only, while a
player puzzle's secret attributes stay server-side.

Each candidate has:

- `id`: stable catalog identifier.
- `difficulty`: integer 1 (Monday) through 7 (Sunday).
- `source_refs`: non-empty array of Wikidata QIDs backing its facts.
- `repeat_keys`: unique QIDs that must not recur inside that game's repeat window.
- `public` and `solution`: separate client-safe content and private answers.

Connections candidates additionally provide `possible_groups`: every verified
four-entity category that could be formed from the 16 tiles. The validator
requires exactly one exact-cover solution. Grid candidates provide three row
conditions, three column conditions, and nine answer arrays in row-major order;
each cell must have 3–60 verified answers. Player candidates use a QID as
`solution.player` and provide `club`, `country`, `position`, `age`,
`shirt_number`, and `height_cm` in `public.player`.

The weekly difficulty scale is Monday 1 through Sunday 7. A puzzle must match
the date's level exactly. Players used in a game are not reused for 30 days;
Connections and Grid may reuse players after that cooldown only in a different
puzzle. A player target may recur after its cooldown only when the complete
puzzle content is different; the content hash prevents exact duplicates. If no
eligible combination remains, generation fails visibly instead of publishing a
duplicate or inventing answers.

The generator keeps answers in the private Supabase schema. The scheduled
workflow requires repository secrets `PUZZLE_SEED_SECRET`, `SUPABASE_URL`, and
`SUPABASE_SECRET_KEY`, plus the SQL migration `supabase-daily-games.sql` applied
to the Supabase project. The HMAC seed is never committed or sent to clients.
GitHub Actions refreshes the 60-day reserve every six hours. This is continuous
daily publication, not an infinite supply of unique footballers; if the source
pool becomes insufficient or Wikidata is unavailable, the workflow fails
visibly rather than inventing answers.

The migration also provides a service-role-only emergency replacement RPC,
`publish_daily_game_replacement`. It replaces only an already-published date,
keeps the original puzzle and repetition ledger for audit, and changes both the
public clues and private validation answer atomically. Record the correction
reason; do not put solutions or service credentials in the public repository.
Guess validation is limited to 20 requests per player and game per minute.

Daily and weekly league XP is written only for the current Madrid date.
Archived games remain playable but do not change streaks or league XP.

Run the synthetic-only pipeline tests with:

```powershell
node --test tests\daily-games.test.mjs tests\wikidata-puzzle-catalog.test.mjs
```

The test fixtures are deliberately synthetic and are never publishable catalog
entries.
