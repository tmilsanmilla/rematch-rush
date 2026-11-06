// Arrange an already-controlled possession for tests of other mechanics. Tests
// of receiving/first-touch timing use Game.setOwner directly and the real clock.
export function giveBall(game, player) {
 const result=game.setOwner(player);
 if(result!==false&&Number.isFinite(game.actionClock))player.shotReadyAt=game.actionClock;
 return result;
}
