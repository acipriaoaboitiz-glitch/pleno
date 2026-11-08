# Supabase SQL workflow

## New project

Run `supabase-bootstrap.sql` first in the Supabase SQL Editor. It creates the
foundational league, membership, fixture, and prediction tables plus the
authenticated league RPCs and row-level security policies. It is not a complete
installation of every PLENO feature. Apply only the incremental scripts for
features you enable, after checking their dependencies below and in each file.
Never paste every SQL file into one query.

The bootstrap does not create Supabase Auth users or configure login providers.
Configure the site's URL and redirect URLs in Supabase Auth, then create an
account through PLENO. `supabase-sync.sql` adds the fixture synchronization
policy used by the app's prediction lifecycle; apply it after the bootstrap.
If PLENO reports `permission denied for table league_matches`, re-run the
complete `supabase-sync.sql` in the Supabase SQL Editor. It removes the
bootstrap prediction policies that directly queried the private fixture table
and replaces them with permission-safe policies.
Run `supabase-delete-league.sql` after the bootstrap to enable league ownership,
leaving, and deletion. The other scripts are feature migrations, not bootstrap
files; some require tables or RPCs created by other feature scripts.

For the league scoreboard, apply `supabase-minigames.sql` first, then run the
complete `supabase-score-settlement.sql` in the Supabase SQL Editor. The latter
installs `get_league_scoreboards` and depends on the fixture, prediction,
inventory, and minigame tables. If the app reports that the function is missing
from the schema cache, apply the migration and use the page's **Reintentar**
button.

Daily games additionally require `supabase-daily-games.sql`, a reviewed catalog
uploaded to the private `puzzle-catalog` Storage bucket, and the GitHub Actions
secrets described below. An empty catalog intentionally publishes no puzzles.

The root `supabase-*.sql` files are incremental feature scripts, not a complete
database bootstrap. They depend on core tables such as `leagues`,
`league_members`, and `predictions`, which are not created by this repository.
The bootstrap above supplies those core tables for new projects. Do not run
every file against a new or production project as one unreviewed batch.

For the age-confirmation change, run `supabase-age-consent.sql` in the Supabase
SQL Editor. It is idempotent and can be re-run safely. It creates or updates
`user_legal_consents`, enables row-level security, and only allows each
authenticated user to manage their own consent record. The existing
`supabase-privacy-moderation.sql` also contains the same schema change for
future setups.

For league display-name changes, run `supabase-rename-league-display-name.sql`
in the Supabase SQL Editor. The RPC only lets an authenticated user update
their own membership name and validates the normalized name length.

For league owners to rename their leagues, run `supabase-rename-league.sql`.
First apply `supabase-delete-league.sql`, which adds the `owner_id` column this
RPC uses to verify ownership. The rename RPC accepts names from 1 to 50
characters after trimming repeated whitespace.

For league owners to remove a member, run `supabase-remove-league-member.sql`
after `supabase-delete-league.sql`. Only the creator can remove another member;
the creator cannot remove themself through this RPC. A removed member's
predictions are retained, matching the existing leave-league behavior, and
become available again if they rejoin.

The repository does not yet have a verified migration baseline for the
existing Supabase project. Before converting the remaining feature scripts to
versioned migrations or assembling a one-shot bundle, compare them with the
project's applied schema; otherwise an already-applied or dependent script
could fail partway through.

## Daily challenge automation

The paid Render cron has been removed. GitHub Actions runs
`.github/workflows/publish-daily-challenge.yml` daily and can also be started
manually. Add these repository Actions secrets:

- `FOOTBALL_DATA_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

The separate daily-puzzle workflow also needs `PUZZLE_SEED_SECRET`. Scheduled
workflows require GitHub Actions to be enabled for the repository.
