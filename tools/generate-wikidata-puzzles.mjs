import { buildSchedule, madridDate, validateCatalog } from "./puzzle-pipeline.mjs";
import { buildWikidataCatalog, fetchWikidataPlayers } from "./wikidata-puzzle-catalog.mjs";

const DAYS = 60;

async function postRpc(supabaseUrl, serviceKey, name, payload) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase RPC ${name} respondió ${response.status}: ${body.slice(0, 500)}`);
  }
  return body;
}

async function main() {
  const seed = process.env.PUZZLE_SEED_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!seed || !supabaseUrl || !serviceKey) {
    throw new Error("Configura PUZZLE_SEED_SECRET, SUPABASE_URL y SUPABASE_SECRET_KEY.");
  }

  const start = madridDate();
  const endDate = new Date(`${start}T12:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + DAYS - 1);
  const historyResponse = await postRpc(supabaseUrl, serviceKey, "get_daily_game_schedule", {
    p_start_date: start,
    p_end_date: endDate.toISOString().slice(0, 10)
  });
  let history;
  try {
    history = JSON.parse(historyResponse);
  } catch {
    throw new Error("Supabase devolvió un historial de puzzles con JSON inválido.");
  }
  const playerRows = await fetchWikidataPlayers();
  const catalog = buildWikidataCatalog(playerRows, start, seed, history);
  validateCatalog(catalog, { requireCandidates: false });
  const schedule = buildSchedule(catalog, start, DAYS, seed, history, { requireCandidates: false });
  const entityResponse = await postRpc(supabaseUrl, serviceKey, "publish_daily_game_entities", {
    p_entities: catalog.entities
  });
  const entityCount = Number(entityResponse);
  if (!Number.isInteger(entityCount) || entityCount !== catalog.entities.length) {
    throw new Error(`Supabase sincronizó ${entityResponse} de ${catalog.entities.length} entidades.`);
  }

  let published = 0;
  for (const puzzle of schedule) {
    if (puzzle.existing) continue;
    const result = await postRpc(supabaseUrl, serviceKey, "publish_daily_game_puzzle", {
      p_game: puzzle.game,
      p_puzzle_date: puzzle.puzzle_date,
      p_payload: puzzle.payload,
      p_solution: puzzle.solution,
      p_content_hash: puzzle.content_hash,
      p_difficulty: puzzle.difficulty,
      p_repeat_key_hashes: puzzle.repeat_key_hashes,
      p_repeat_window_days: puzzle.repeat_window_days,
      p_source_refs: puzzle.source_refs
    });
    if (result === "true") published++;
  }
  console.log(
    `Wikidata: ${playerRows.length} filas; ${catalog.entities.length} jugadores; ` +
    `${schedule.length} puzzles planificados, ${published} nuevos desde ${start} (Europe/Madrid).`
  );
}

main().catch((error) => {
  console.error(`Generación diaria desde Wikidata fallida: ${error.message}`);
  process.exitCode = 1;
});
