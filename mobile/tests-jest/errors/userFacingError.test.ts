import { ApiError } from '../../src/api/client';
import { userFacingError } from '../../src/errors/userFacingError';

test('known refusals get their own sentence', () => {
  expect(userFacingError(new ApiError(429, { error: 'rate_limited' }), 'Couldn’t create that hideout.')).toBe('Too many attempts. Wait a moment and try again.');
  expect(userFacingError(new ApiError(400, { error: 'objectionable_content' }), 'Couldn’t create that hideout.')).toBe('That isn’t allowed here. Try different wording.');
});

test('no answer, a timeout or a server error points at the connection; never raw text', () => {
  expect(userFacingError(new TypeError('Network request failed'), 'Couldn’t connect to voice.')).toBe('Couldn’t connect to voice. Check your connection and try again.');
  expect(userFacingError(new ApiError(503, { error: 'unavailable' }), 'Couldn’t connect to voice.')).toBe('Couldn’t connect to voice. Check your connection and try again.');
  expect(userFacingError(new ApiError(408, null), 'Couldn’t connect to voice.')).toBe('Couldn’t connect to voice. Check your connection and try again.');
  expect(userFacingError('weird', 'Couldn’t delete that hideout.')).toBe('Couldn’t delete that hideout. Check your connection and try again.');
});

test('other refusals say only what didn’t happen', () => {
  expect(userFacingError(new ApiError(403, { error: 'forbidden' }), 'Couldn’t delete that hideout.')).toBe('Couldn’t delete that hideout.');
  expect(userFacingError(new ApiError(404, 'not json'), 'Couldn’t delete that hideout.')).toBe('Couldn’t delete that hideout.');
});
