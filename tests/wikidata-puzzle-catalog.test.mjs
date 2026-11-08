import test from "node:test";
import assert from "node:assert/strict";
import { buildSchedule, validateCatalog } from "../tools/puzzle-pipeline.mjs";
import { buildWikidataCatalog } from "../tools/wikidata-puzzle-catalog.mjs";

function playerRows() {
  const rows = [];
  for (let index = 0; index < 2400; index++) {
    const country = index % 12 + 1;
    const position = Math.floor(index / 12) % 5 + 1;
    const club = index % 20 + 1;
    const bind = (value) => ({ value });
    rows.push({
      player: bind(`http://www.wikidata.org/entity/Q${10000 + index}`),
      playerLabel: bind(`Jugador verificado ${index}`),
      birth: bind("1995-01-01T00:00:00Z"),
      height: bind("175"),
      country: bind(`http://www.wikidata.org/entity/Q${20000 + country}`),
      countryLabel: bind(`País ${country}`),
      position: bind(`http://www.wikidata.org/entity/Q${30000 + position}`),
      positionLabel: bind(`Posición ${position}`),
      club: bind(`http://www.wikidata.org/entity/Q${40000 + club}`),
      clubLabel: bind(`Club ${club}`),
      number: bind(String(index % 99 + 1))
    });
  }
  return rows;
}

test("builds source-backed puzzles and a valid 60-day schedule", () => {
  const seed = "test-seed-at-least-32-characters-long";
  const catalog = buildWikidataCatalog(playerRows(), "2026-11-08", seed);
  validateCatalog(catalog);
  assert.equal(catalog.connections.length, 60);
  assert.equal(catalog.grid.length, 60);
  assert.equal(catalog.player.length, 60);
  assert.equal(new Set(catalog.entities.map((entity) => entity.id)).size, catalog.entities.length);

  const schedule = buildSchedule(catalog, "2026-11-08", 60, seed);
  assert.equal(schedule.length, 180);
  for (const game of ["connections", "grid", "player"]) {
    const entries = schedule.filter((puzzle) => puzzle.game === game);
    assert.equal(new Set(entries.map((puzzle) => puzzle.content_hash)).size, 60);
    for (let index = 0; index < entries.length; index++) {
      const recentKeys = new Set(entries[index].repeat_key_hashes);
      for (let previous = Math.max(0, index - 30); previous < index; previous++) {
        assert.ok(entries[previous].repeat_key_hashes.every((key) => !recentKeys.has(key)));
      }
    }
  }

  const history = {
    puzzles: schedule.map(({ game, puzzle_date, content_hash, repeat_key_hashes }) => ({
      game, puzzle_date, content_hash, repeat_key_hashes
    })),
    content_hashes: Object.fromEntries(["connections", "grid", "player"].map((game) => [
      game, schedule.filter((puzzle) => puzzle.game === game).map((puzzle) => puzzle.content_hash)
    ])),
    player_used_key_hashes: schedule
      .filter((puzzle) => puzzle.game === "player")
      .flatMap((puzzle) => puzzle.repeat_key_hashes)
  };
  const alreadyPublished = buildWikidataCatalog(playerRows(), "2026-11-08", seed, history);
  validateCatalog(alreadyPublished, { requireCandidates: false });
  const existingSchedule = buildSchedule(alreadyPublished, "2026-11-08", 60, seed, history, {
    requireCandidates: false
  });
  assert.equal(existingSchedule.length, 180);
  assert.ok(existingSchedule.every((puzzle) => puzzle.existing));
});
