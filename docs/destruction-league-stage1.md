# Destruction League Stage I expansion

This batch adds all requested modes and the five initial optional DLSI styles.
Base moves remain available, and each unlocked move and awakening can be toggled
independently. The character guide previews locked variants too.

## Football

Held shots start at 5 and gain exactly 12 power per second. World travel is 15%
faster than the preceding .85 pace; bot movement is .98 of a human's. The normal
maximum launch equals the preceding 90-power launch. Backward aim has no strength
penalty. New stuns are 10% shorter. Goalkeeper throws lead slightly farther, have
30% less airtime, and retain a release-time placement error. A teammate back-pass
is cleared upfield with broad spread instead of being caught and thrown.

The lighter, untinted pitch sits above large labeled controls. Replays record
25 seconds including cinematic poses/story panels and play at 2×, up to12.5s.
Every human must vote R to skip; bots need no vote. Golden-goal overtime selects
one eligible awakening recipient per side. Raw Skill remains characterless.

## Matches

Offline Standard and Raw Skill offer1v1/2v2/3v3. Online queues offer all those
formats and1v1 penalties. Custom rooms allow up to3 per side, including3v1,
manual bot styles, and Standard/Raw/Penalties rules. Raw is always180seconds.
Four-character room codes use distinct symbols from
`ABCDEFGHJKLMNPQRSTUVWXYZ123456789`. Automatic bots match human rarity
proportionally; duplicates are allowed.

Penalty matches give each human5 shots as attacker and one turn as goalkeeper.
Ties use a smaller, goal-free five-ball sudden-death field. Any moving-ball contact
eliminates; stopped balls can be held but not carried. Off-ball charging is
allowed. Practice gives the human10 attempts with no win/loss. Neither variant
earns league points.

## Rewards and progression

Match actions pay ankle-break1, awakening1, steal2, assist5, goal10. Completion
uses the written reward schedule rather than the contradictory sample Python:
wins by1..5 pay28/31/34/37/40,6+ pays42; losses pay16/13/10/7/4,6+ pays2;
a draw pays22. Abandoning earns nothing. Opponent abandonment keeps action
rewards without a completion bonus. Normal spins cost35; lucky spins95 and
require5 distinct owned characters. Existing guest unlocks are retained.

Human actors earn style points: goal10, assist5, steal3, ankle-break1,
awakening1, completed match5. Stage I lasts14days. The lowest5 styles leave the
league standings after the stage; they remain playable.300 style points unlock
the DLSI awakening. Each quest separately unlocks its move:

| Style | Move quests |
| --- | --- |
| Manmarker |25 steals;25 shot interceptions;50 move uses|
| Powershooter |30 goals;30 steals;25 skill goals|
| Playmaker |55 passes;30 assists;25 goals|
| Street Dribbler |100 ankle-breaks;50 dribble-then-goals;200 dribbles|
| Supersonic |1800 movement seconds;one nonstop match;100 steals;10 fourth-awakening uses|

## Account storage and administrator boundary

Guest progress is stored separately on the device and is never adopted into a
Pixel account. Signed-in progress uses existing immutable Rematch account IDs.
No new passwords, providers, identity fixtures, email or guest-account linking
are required by this feature. Account game-data API calls require the existing
opaque, bounded, current-epoch Rematch session. Expired/uncertain operations keep
the same receipt across reauthentication; retry cannot charge another spin.

Account settlement replays the actual game engine against the saved roster,
settings, seed and bounded human input record. Caller scores, statistics and
balances do not authorize payouts. Replayed time cannot exceed server elapsed
time and normal completion must reach full time. This verifies simulation
consistency, not human presence, remote room membership or anti-automation.
Only the controlled human actor receives points. All actual simulation inputs
remain client-originated in this peer-hosted architecture.

`rematch_game` is an additive namespace in the existing dedicated target.
`ops/game-extension.mjs` prepares pinned DDL and a complete-review checklist;
unrendered DDL aborts and rendered output ends in ROLLBACK. It does not connect
or apply changes. Existing auth schema/roles/history/rows must remain preserved.
Runtime and migration ownership stay separate, with explicit per-table grants.
There is no runtime DDL.

Initial Edung access requires an operator-verified immutable account and binding
correspondence. Display-name equality cannot bootstrap a role. Existing admins
can grant/revoke/check styles, add/remove admins, ban/unban/query and dismiss
appeals. A ban requires a reason; finite durations extend, infinite dominates,
and remaining minutes round up. Ambiguous usernames are refused. The final
active admin cannot be removed; self-bans require another admin.

## Verification limits

The normal suite uses credential-free synthetic models and temporary loopback
HTTP only. `test/game-native.mjs` is runnable preparation for a separately approved
fresh local fixture, with exact source/DDL pins, finite permission, isolated
roles, observed own PID/blocker waits, clock-expiry rollback and ACL checks.
Importing it does not create a driver, engine, role, database or connection.
It has not been executed against a native database for this expansion.
Production operator application/admin bootstrap/configuration is separate.
No two-physical-device FPS or genuine account settlement acceptance is claimed
from the offline tests or static local preview.
