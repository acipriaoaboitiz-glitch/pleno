import { createHash, createHmac } from "node:crypto";
import { REPEAT_DAYS, difficultyForDate, preparePuzzle } from "./puzzle-pipeline.mjs";

const QUERY_PAGE_SIZE = 1000;
const COLORS = ["yellow", "green", "blue", "purple"];
const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const query = `
SELECT ?player ?playerLabel ?birth ?height ?country ?countryLabel
       ?position ?positionLabel ?club ?clubLabel ?number
WHERE {
  ?club wdt:P118 wd:Q15804.
  ?player wdt:P106 wd:Q937857;
          wdt:P569 ?birth;
          wdt:P2048 ?height;
          wdt:P27 ?country;
          wdt:P413 ?position;
          wdt:P1618 ?number;
          p:P54 ?membership.
  ?membership ps:P54 ?club.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}
ORDER BY ?player ?club ?country ?position ?birth ?height ?number`;

const bindingValue = (row, key) => row?.[key]?.value || "";
const qid = (uri) => /\/(Q\d+)$/.exec(uri)?.[1] || "";
const normalized = (name) => name.trim().toLocaleLowerCase("es").replace(/\s+/g, " ");
const hash = (value) => createHash("sha256").update(value).digest("hex");

function stableOrder(items, salt, getKey = (item) => typeof item === "string" ? item : item.id) {
  return [...items].sort((a, b) =>
    hash(`${salt}:${getKey(a)}`).localeCompare(hash(`${salt}:${getKey(b)}`))
  );
}

function heightInCentimeters(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
}

function ageOn(birthDate, date) {
  const birth = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
  const now = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(birth.valueOf()) || birth > now) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
  ) age--;
  return age > 0 ? age : null;
}

export async function fetchWikidataPlayers(fetchImpl = fetch) {
  const rows = [];
  for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
    const pagedQuery = `${query}\nLIMIT ${QUERY_PAGE_SIZE} OFFSET ${offset}`;
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetchImpl(`${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(pagedQuery)}&format=json`, {
        headers: {
          accept: "application/sparql-results+json",
          "user-agent": "PLENO daily puzzles (GitHub: acipriaoaboitiz-glitch/P-L-E-N-O)"
        },
        signal: AbortSignal.timeout(60000)
      });
      if (response.ok) {
        result = await response.json();
        break;
      }
      const body = await response.text();
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
        throw new Error(`Wikidata respondió ${response.status}: ${body.slice(0, 300)} ${body.slice(-900)}`);
      }
      await wait(1000 * (attempt + 1));
    }
    if (!Array.isArray(result?.results?.bindings)) {
      throw new Error("Wikidata devolvió un resultado SPARQL con formato inválido.");
    }
    rows.push(...result.results.bindings);
    if (result.results.bindings.length < QUERY_PAGE_SIZE) break;
    await wait(1100);
  }
  return rows;
}

function normalizePlayers(rows, date) {
  const byId = new Map();
  for (const row of rows) {
    const id = qid(bindingValue(row, "player"));
    const countryId = qid(bindingValue(row, "country"));
    const positionId = qid(bindingValue(row, "position"));
    const clubId = qid(bindingValue(row, "club"));
    const name = bindingValue(row, "playerLabel").trim();
    const country = bindingValue(row, "countryLabel").trim();
    const position = bindingValue(row, "positionLabel").trim();
    const club = bindingValue(row, "clubLabel").trim();
    const shirtNumber = Number(bindingValue(row, "number"));
    const heightCm = heightInCentimeters(bindingValue(row, "height"));
    const age = ageOn(bindingValue(row, "birth"), date);
    if (
      !id || !countryId || !positionId || !clubId || !name || !country || !position || !club ||
      !Number.isInteger(shirtNumber) || shirtNumber < 1 || shirtNumber > 99 ||
      !heightCm || heightCm < 130 || heightCm > 230 || !age
    ) continue;
    if (!byId.has(id)) {
      byId.set(id, {
        id, name, country, countryId, position, positionId, club, clubId,
        attributes: {
          club, country, position, age, shirt_number: shirtNumber, height_cm: heightCm
        }
      });
    }
  }

  const uniqueNames = new Map();
  for (const player of [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = normalized(player.name);
    if (!uniqueNames.has(key)) uniqueNames.set(key, player);
  }
  return [...uniqueNames.values()];
}

function findGridAxes(players, salt) {
  const cells = new Map();
  const positions = new Map();
  const countries = new Map();
  for (const player of players) {
    positions.set(player.positionId, player.position);
    countries.set(player.countryId, player.country);
    const key = `${player.positionId}:${player.countryId}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(player);
  }
  const positionIds = [...positions.keys()].filter((id, index, all) =>
    all.findIndex((other) => normalized(positions.get(other)) === normalized(positions.get(id))) === index
  );
  const countryIds = [...countries.keys()].filter((id, index, all) =>
    all.findIndex((other) => normalized(countries.get(other)) === normalized(countries.get(id))) === index
  );
  for (let attempt = 0; attempt < 50; attempt++) {
    const rows = stableOrder(positionIds, `${salt}:positions:${attempt}`).slice(0, 3);
    const columns = stableOrder(countryIds.filter((countryId) =>
      rows.every((positionId) => (cells.get(`${positionId}:${countryId}`)?.length || 0) >= 3)
    ), `${salt}:countries:${attempt}`).slice(0, 3);
    if (rows.length === 3 && columns.length === 3) {
      return { rows, columns, cells, positions, countries };
    }
  }
  throw new Error("Wikidata no ofrece tres posiciones y tres países con suficientes respuestas para el Cruce 3×3.");
}

function daysBetween(date, previousDate) {
  return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`)) / 86400000;
}

function hashRepeatKey(seed, game, playerId) {
  return createHmac("sha256", seed).update(`${game}:${playerId}`).digest("hex");
}

function loadUsage(existing) {
  const usage = new Map();
  for (const puzzle of existing.puzzles || []) {
    for (const key of puzzle.repeat_key_hashes || []) {
      const mapKey = `${puzzle.game}:${key}`;
      const previous = usage.get(mapKey);
      if (!previous || puzzle.puzzle_date > previous) usage.set(mapKey, puzzle.puzzle_date);
    }
  }
  return usage;
}

function playersAvailable(players, game, date, seed, usage) {
  const cooldown = REPEAT_DAYS[game];
  return players.filter((player) => {
    const previousDate = usage.get(`${game}:${hashRepeatKey(seed, game, player.id)}`);
    return !previousDate || daysBetween(date, previousDate) > cooldown;
  });
}

function connectionCandidate(players, date, difficulty, seed, attempt) {
  const clubs = new Map();
  for (const player of players) {
    if (!clubs.has(player.clubId)) {
      clubs.set(player.clubId, { id: player.clubId, name: player.club, players: [] });
    }
    clubs.get(player.clubId).players.push(player);
  }
  const eligible = [...clubs.values()]
    .filter((club) => club.players.length >= 4)
    .filter((club, index, all) =>
      all.findIndex((other) => normalized(other.name) === normalized(club.name)) === index
    );
  if (eligible.length < 4) return null;
  const salt = `${seed}:${date}:connections:${attempt}`;
  const selectedClubs = stableOrder(eligible, salt).slice(0, 4);
  const groups = selectedClubs.map((club, index) => ({
    category: `Jugadores que pasaron por el ${club.name}`,
    color: COLORS[index],
    members: stableOrder(club.players, `${salt}:${club.id}`).slice(0, 4).map((player) => player.id)
  }));
  const repeatKeys = groups.flatMap((group) => group.members);
  if (new Set(repeatKeys).size !== 16) return null;
  const tiles = stableOrder(repeatKeys, `${salt}:tiles`);
  return {
    id: `wikidata-connections-${date}-${attempt}-${hash(repeatKeys.join(",")).slice(0, 12)}`,
    schedule_date: date,
    difficulty,
    source_refs: [...new Set(selectedClubs.flatMap((club, index) =>
      [club.id, ...groups[index].members]
    ))],
    repeat_keys: tiles,
    possible_groups: groups.map(({ category, members }) => ({ category, members })),
    public: { tiles },
    solution: { groups }
  };
}

function gridCandidate(players, date, difficulty, seed, attempt) {
  let axes;
  try {
    axes = findGridAxes(players, `${seed}:${date}:grid:${attempt}`);
  } catch {
    return null;
  }
  const cells = [];
  const repeatKeys = [];
  for (const positionId of axes.rows) {
    for (const countryId of axes.columns) {
      const answers = stableOrder(
        axes.cells.get(`${positionId}:${countryId}`) || [],
        `${seed}:${date}:grid:${attempt}:${positionId}:${countryId}`
      ).filter((player) => !repeatKeys.includes(player.id)).slice(0, 3);
      if (answers.length !== 3) return null;
      const ids = answers.map((player) => player.id);
      cells.push(ids);
      repeatKeys.push(...ids);
    }
  }
  if (new Set(repeatKeys).size !== 27) return null;
  return {
    id: `wikidata-grid-${date}-${attempt}-${hash([...axes.rows, ...axes.columns, ...repeatKeys].join(",")).slice(0, 12)}`,
    schedule_date: date,
    difficulty,
    source_refs: [...new Set([...axes.rows, ...axes.columns, ...repeatKeys])],
    repeat_keys: repeatKeys,
    public: {
      rows: axes.rows.map((id) => `Juega como ${axes.positions.get(id)}`),
      columns: axes.columns.map((id) => `Es de ${axes.countries.get(id)}`)
    },
    solution: { cells }
  };
}

function playerCandidate(players, date, difficulty, seed, attempt) {
  const player = stableOrder(players, `${seed}:${date}:player:${attempt}`)[0];
  if (!player) return null;
  return {
    id: `wikidata-player-${date}-${attempt}-${player.id}`,
    schedule_date: date,
    difficulty,
    source_refs: [player.id, player.clubId, player.countryId, player.positionId],
    repeat_keys: [player.id],
    public: { player: player.attributes },
    solution: { player: player.id }
  };
}

export function buildWikidataCatalog(rows, startDate, seed, existing = {}) {
  const players = normalizePlayers(rows, startDate);
  if (players.length < 100) {
    throw new Error(`Solo se encontraron ${players.length} jugadores con datos completos; se necesitan al menos 100.`);
  }
  const usage = loadUsage(existing);
  const contentHashes = new Map(["connections", "grid", "player"].map((game) => [
    game,
    new Set(existing.content_hashes?.[game] || [])
  ]));
  const usedPlayerKeys = new Set(existing.player_used_key_hashes || []);
  const existingPuzzles = new Set((existing.puzzles || []).map((puzzle) =>
    `${puzzle.game}:${puzzle.puzzle_date}`
  ));
  const candidates = { connections: [], grid: [], player: [] };
  for (let day = 0; day < 60; day++) {
    const currentDate = new Date(`${startDate}T12:00:00Z`);
    currentDate.setUTCDate(currentDate.getUTCDate() + day);
    const date = currentDate.toISOString().slice(0, 10);
    const difficulty = difficultyForDate(date);
    for (const game of ["connections", "grid", "player"]) {
      if (existingPuzzles.has(`${game}:${date}`)) continue;
      let available = playersAvailable(players, game, date, seed, usage);
      if (game === "player") {
        const unseen = available.filter((player) => !usedPlayerKeys.has(hashRepeatKey(seed, "player", player.id)));
        if (unseen.length) available = unseen;
      }
      let selected;
      for (let attempt = 0; attempt < 250 && !selected; attempt++) {
        const candidate = game === "connections"
          ? connectionCandidate(available, date, difficulty, seed, attempt)
          : game === "grid"
            ? gridCandidate(available, date, difficulty, seed, attempt)
            : playerCandidate(available, date, difficulty, seed, attempt);
        if (!candidate) continue;
        const contentHash = preparePuzzle(game, candidate, date, seed).content_hash;
        if (contentHashes.get(game).has(contentHash)) continue;
        selected = candidate;
        contentHashes.get(game).add(contentHash);
      }
      if (!selected) {
        throw new Error(`No se pudo crear un puzzle único de ${game} para ${date} respetando los 30 días sin repetir jugadores.`);
      }
      candidates[game].push(selected);
      for (const key of selected.repeat_keys) {
        usage.set(`${game}:${hashRepeatKey(seed, game, key)}`, date);
      }
      if (game === "player") {
        usedPlayerKeys.add(hashRepeatKey(seed, game, selected.solution.player));
      }
    }
  }
  const catalog = {
    version: 1,
    attribution: "Wikidata (CC0); datos de jugadores, clubes y competiciones consultados en Wikidata.",
    entities: [],
    ...candidates
  };
  const needed = new Set([
    ...catalog.connections.flatMap((candidate) => candidate.repeat_keys),
    ...catalog.grid.flatMap((candidate) => candidate.repeat_keys),
    ...catalog.player.flatMap((candidate) => candidate.repeat_keys)
  ]);
  catalog.entities = players.filter((player) => needed.has(player.id)).map((player) => ({
    id: player.id,
    name: player.name,
    attributes: player.attributes
  }));
  return catalog;
}
