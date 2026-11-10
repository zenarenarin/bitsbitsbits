// Load the pure modules (util, puzzle, themes) into Node for tests.
const fs = require('fs'), path = require('path');
module.exports = function () {
  const dir = path.join(__dirname, '..', 'src');
  const src = ['00_util.js', '01_puzzle.js', '02_themes.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  return new Function(src + '\nreturn { makeRng, PuzzleGenerator, createGame, PUZZLE_PRESETS, CONDITION_TYPES, condFams, condExplain, condText, stateIndex, stateOffsets, bfs, satMask, famAt, NSTATES, ThemeEngine, ThemeRegistry, shortestSteps, deltaE, contrastRatio, dateKey, dayNumberFromKey, keyFromDayNumber, SEGMENTS, mod };')();
};
