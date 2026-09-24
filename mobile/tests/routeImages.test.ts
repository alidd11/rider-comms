import test from 'node:test';
import assert from 'node:assert/strict';
import {
  routeCardImageUri,
  routeHeroImageUri,
  routeImageUriAtWidth,
} from '../src/routes/routeImages.ts';

test('creates a bounded Wikimedia thumbnail URL from an original Commons image', () => {
  assert.equal(
    routeImageUriAtWidth('https://upload.wikimedia.org/wikipedia/commons/2/27/A25_Shere_Road.jpg', 640),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/A25_Shere_Road.jpg/640px-A25_Shere_Road.jpg',
  );
});

test('resizes an existing Wikimedia thumbnail without changing the source file', () => {
  assert.equal(
    routeHeroImageUri('https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bb/Princetown.jpg/1280px-Princetown.jpg'),
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bb/Princetown.jpg/1600px-Princetown.jpg',
  );
});

test('uses Wikimedia SVG thumbnail naming when needed', () => {
  assert.equal(
    routeImageUriAtWidth('https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.svg', 640),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.svg/640px-Example.svg.png',
  );
});

test('leaves unsupported image hosts untouched', () => {
  assert.equal(
    routeImageUriAtWidth('https://cdn.example.com/route.jpg', 640),
    'https://cdn.example.com/route.jpg',
  );
});



test('sizes route-card images for a high-density display', () => {
  assert.equal(
    routeCardImageUri('https://upload.wikimedia.org/wikipedia/commons/2/27/A25_Shere_Road.jpg', 360, 3),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/A25_Shere_Road.jpg/1080px-A25_Shere_Road.jpg',
  );
});

test('caps route-card image requests at the retina budget', () => {
  assert.equal(
    routeCardImageUri('https://upload.wikimedia.org/wikipedia/commons/2/27/A25_Shere_Road.jpg', 720, 3),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/A25_Shere_Road.jpg/1280px-A25_Shere_Road.jpg',
  );
});

test('never requests less than the bundled route-card fallback width', () => {
  assert.equal(
    routeCardImageUri('https://upload.wikimedia.org/wikipedia/commons/2/27/A25_Shere_Road.jpg', 180, 1),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/A25_Shere_Road.jpg/640px-A25_Shere_Road.jpg',
  );
});
