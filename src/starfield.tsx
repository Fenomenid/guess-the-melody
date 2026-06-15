import { useMemo, type CSSProperties } from 'react';

export type Star = {
  x: number;
  y: number;
  opacity: number;
  twinkleDelay: number;
};

function nextRandom(state: number): [number, number] {
  const nextState = (state * 1664525 + 1013904223) >>> 0;
  return [nextState, nextState / 0x100000000];
}

export function createStars(count: number, seed: number): Star[] {
  let state = seed >>> 0;

  return Array.from({ length: count }, () => {
    let xRandom: number;
    let yRandom: number;
    let opacityRandom: number;
    let delayRandom: number;

    [state, xRandom] = nextRandom(state);
    [state, yRandom] = nextRandom(state);
    [state, opacityRandom] = nextRandom(state);
    [state, delayRandom] = nextRandom(state);

    return {
      x: Math.floor(xRandom * 2000),
      y: Math.floor(yRandom * 2000),
      opacity: 0.35 + opacityRandom * 0.65,
      twinkleDelay: delayRandom * 6
    };
  });
}

const layers = [
  { name: 'far', count: 260, seed: 42 },
  { name: 'middle', count: 90, seed: 31415 },
  { name: 'near', count: 34, seed: 271828 }
] as const;

export function Starfield() {
  const starLayers = useMemo(
    () => layers.map((layer) => ({ ...layer, stars: createStars(layer.count, layer.seed) })),
    []
  );

  return (
    <div className="starfield" aria-hidden="true">
      <div className="starfield-glow" />
      {starLayers.map((layer) => (
        <div className={`starfield-layer starfield-layer-${layer.name}`} key={layer.name}>
          {[0, 2000].flatMap((offset) =>
            layer.stars.map((star, index) => (
              <i
                key={`${offset}-${index}`}
                style={
                  {
                    '--star-x': `${star.x / 20}%`,
                    '--star-y': `${star.y + offset}px`,
                    '--star-opacity': star.opacity,
                    '--twinkle-delay': `${star.twinkleDelay}s`
                  } as CSSProperties
                }
              />
            ))
          )}
        </div>
      ))}
    </div>
  );
}
