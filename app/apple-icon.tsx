import { ImageResponse } from 'next/og';

// Image metadata — iOS uses a 180px apple-touch-icon for the Home
// Screen. Must be an opaque PNG (transparent icons render black).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * ORION Home Screen icon — same orbit-ring + belt-stars motif as the
 * favicon, sized for the iOS apple-touch-icon convention.
 */
export default function AppleIcon() {
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
            width: 108,
            height: 108,
            borderRadius: 54,
            border: '4px solid #f43f5e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: '#f43f5e' }} />
            <div style={{ width: 10, height: 10, borderRadius: 5, background: '#f43f5e' }} />
            <div style={{ width: 10, height: 10, borderRadius: 5, background: '#f43f5e' }} />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
