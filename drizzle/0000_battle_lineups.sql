CREATE TABLE battle_lineups (
    battle_id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL,
    round INTEGER NOT NULL CHECK (round > 0),
    seed INTEGER NOT NULL,
    ruleset INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    fireballs INTEGER NOT NULL DEFAULT 0,
    lineup TEXT NOT NULL CHECK (json_valid(lineup)),
    result TEXT CHECK (result IN ('win', 'loss', 'draw')),
    ticks INTEGER CHECK (ticks >= 0),
    CHECK ((result IS NULL) = (ticks IS NULL))
);
--> statement-breakpoint
CREATE INDEX battle_lineups_by_run ON battle_lineups(run_id, round);
