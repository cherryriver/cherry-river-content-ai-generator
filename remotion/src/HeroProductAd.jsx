// Cherry River — Hero Product Ad (image produit réelle animée par Remotion)
// L'étiquette reste nette : le produit est une image statique, seul Remotion bouge.
// Fond vidéo Seedance optionnel. Format-agnostique (9:16 et 16:9).
const {
  AbsoluteFill, Img, Video, interpolate, spring, useCurrentFrame, useVideoConfig,
} = require("remotion");

const HeroProductAd = ({
  productImage,
  brandName = "CHERRY RIVER",
  kicker = "",
  tagline = "",
  accent = "#FF1B8D",
  backgroundVideo = null,
}) => {
  if (!productImage) {
    throw new Error("HeroProductAd requires a real inventory product image");
  }

  const frame = useCurrentFrame();
  const { fps, durationInFrames, height } = useVideoConfig();
  const u = height / 1000;

  const entrance = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const scale = interpolate(frame, [0, durationInFrames], [0.9, 1.08]) * (0.6 + 0.4 * entrance);
  const tilt = interpolate(frame, [0, durationInFrames], [-1.5, 2]);
  const drift = interpolate(frame, [0, durationInFrames], [12 * u, -12 * u]);
  const sweepX = interpolate(frame, [10, 45], [-60, 160], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const kickerO = interpolate(frame, [8, 20], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const brandO = interpolate(frame, [18, 32], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const brandY = interpolate(frame, [18, 32], [40 * u, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const tagO = interpolate(frame, [28, 42], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const outO = interpolate(
    frame,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0d10", overflow: "hidden", opacity: outO }}>
      {backgroundVideo ? (
        <AbsoluteFill>
          <Video
            src={backgroundVideo}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }}
          />
          <AbsoluteFill style={{
            background: "radial-gradient(120% 90% at 50% 40%, transparent 40%, rgba(10,10,14,0.9) 100%)",
          }} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{
          background: `radial-gradient(60% 55% at 50% 42%, ${accent}22 0%, transparent 60%), radial-gradient(circle at 50% 60%, #23232b 0%, #0d0d10 70%)`,
        }} />
      )}

      <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: 620 * u,
          height: 620 * u,
          borderRadius: "50%",
          background: `${accent}33`,
          filter: `blur(${90 * u}px)`,
          transform: `scale(${0.8 + 0.3 * entrance})`,
        }} />
      </AbsoluteFill>

      <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `translateY(${drift}px) scale(${scale}) rotate(${tilt}deg)` }}>
          <Img
            src={productImage}
            style={{
              maxHeight: 720 * u,
              maxWidth: "82%",
              objectFit: "contain",
              filter: `drop-shadow(0px ${34 * u}px ${26 * u}px rgba(0,0,0,0.65))`,
            }}
          />
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{
        background: `linear-gradient(105deg, transparent ${sweepX - 12}%, rgba(255,255,255,0.10) ${sweepX}%, transparent ${sweepX + 12}%)`,
        mixBlendMode: "screen",
        pointerEvents: "none",
      }} />

      {kicker ? (
        <AbsoluteFill style={{
          alignItems: "center", justifyContent: "flex-start", paddingTop: 90 * u, opacity: kickerO,
        }}>
          <div style={{
            color: accent,
            fontFamily: "Helvetica, Arial, sans-serif",
            fontWeight: 700,
            fontSize: 26 * u,
            letterSpacing: 8 * u,
            textTransform: "uppercase",
          }}>
            {kicker}
          </div>
        </AbsoluteFill>
      ) : null}

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 110 * u }}>
        <div style={{
          opacity: brandO,
          transform: `translateY(${brandY}px)`,
          color: "#fff",
          fontFamily: "'Arial Black','Helvetica',sans-serif",
          fontWeight: 900,
          fontSize: 92 * u,
          letterSpacing: 6 * u,
          textTransform: "uppercase",
          textAlign: "center",
          textShadow: `0 ${4 * u}px ${16 * u}px rgba(0,0,0,0.55)`,
          lineHeight: 0.95,
        }}>
          {brandName}
        </div>
        {tagline ? (
          <div style={{
            opacity: tagO,
            color: "rgba(255,255,255,0.85)",
            fontFamily: "Helvetica, Arial, sans-serif",
            fontWeight: 300,
            fontSize: 26 * u,
            letterSpacing: 10 * u,
            textTransform: "uppercase",
            marginTop: 18 * u,
          }}>
            {tagline}
          </div>
        ) : null}
      </AbsoluteFill>

      <AbsoluteFill style={{
        boxShadow: `inset 0 0 ${240 * u}px rgba(0,0,0,0.7)`, pointerEvents: "none",
      }} />
    </AbsoluteFill>
  );
};

module.exports = { HeroProductAd };
