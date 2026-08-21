import { ImageResponse } from 'next/og';

// Image metadata — a single 512px square icon reused by the favicon
// <link> and the web app manifest (browsers scale it down for 192px).
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/**
 * ORION app icon — a rose orbit ring with the three "belt" stars.
 * Solid, opaque background (iOS renders transparent apple-touch-icons
 * as black, so we never emit transparency here).
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
        }}
      >
        <div
          style={{
            width: 300,
            height: 300,
            borderRadius: 150,
            border: '8px solid #f43f5e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <div style={{ width: 26, height: 26, borderRadius: 13, background: '#f43f5e' }} />
            <div style={{ width: 26, height: 26, borderRadius: 13, background: '#f43f5e' }} />
            <div style={{ width: 26, height: 26, borderRadius: 13, background: '#f43f5e' }} />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
