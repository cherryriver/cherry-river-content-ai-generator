const { Composition, Video, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring } = require("remotion");

// ── Title Card ───────────────────────────────────────────────────────────────
const TitleCard = ({ brandName, productLine, subtitle, bgColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const titleOpacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [10, 20], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div style={{
      width: "100%", height: "100%",
      background: bgColor || "#FF1493",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'Arial Black', 'Impact', sans-serif",
    }}>
      <div style={{
        transform: `scale(${titleScale})`,
        opacity: titleOpacity,
        textAlign: "center",
      }}>
        <div style={{
          color: "white", fontSize: 130, fontWeight: 900,
          lineHeight: 0.9, letterSpacing: -4,
          textShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}>
          {brandName}
        </div>
        <div style={{
          color: "white", fontSize: 60, fontWeight: 400,
          letterSpacing: 16, marginTop: 20,
        }}>
          {productLine}
        </div>
      </div>
      <div style={{
        opacity: subtitleOpacity,
        color: "rgba(255,255,255,0.9)",
        fontSize: 36, letterSpacing: 6,
        marginTop: 30, fontWeight: 300,
      }}>
        {subtitle}
      </div>
    </div>
  );
};

// ── Video Shot ───────────────────────────────────────────────────────────────
const Shot = ({ src, startFrom = 0, fadeIn = true, fadeOut = true }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const opacity = interpolate(
    frame,
    [0, fadeIn ? 8 : 0, durationInFrames - (fadeOut ? 8 : 0), durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div style={{ width: "100%", height: "100%", opacity }}>
      <Video
        src={src}
        startFrom={startFrom}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
};

// ── End Card ─────────────────────────────────────────────────────────────────
const EndCard = ({ logoSrc, bgColor, tagline }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const logoScale = spring({ frame, fps: 30, config: { damping: 18, stiffness: 100 } });

  return (
    <div style={{
      width: "100%", height: "100%",
      background: bgColor || "#FF1493",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      opacity,
    }}>
      {logoSrc && (
        <img
          src={logoSrc}
          style={{ width: 320, transform: `scale(${logoScale})`, marginBottom: 40 }}
        />
      )}
      {tagline && (
        <div style={{
          color: "white", fontSize: 32, letterSpacing: 8,
          fontFamily: "Arial, sans-serif", fontWeight: 300,
          textAlign: "center",
        }}>
          {tagline}
        </div>
      )}
    </div>
  );
};

// ── Main Composition ─────────────────────────────────────────────────────────
const PamplemousseCommercial = ({ shot1, shot2, shot3 }) => {
  const TITLE_DUR = 72;   // 3s @ 24fps
  const SHOT_DUR  = 120;  // 5s @ 24fps
  const END_DUR   = 48;   // 2s @ 24fps

  return (
    <div style={{ width: "100%", height: "100%", background: "#000", overflow: "hidden" }}>
      {/* Title Card */}
      <Sequence from={0} durationInFrames={TITLE_DUR}>
        <TitleCard
          brandName={"CHERRY\nRIVER"}
          productLine="GIN"
          subtitle="PAMPLEMOUSSE ROSÉ"
          bgColor="#FF1B8D"
        />
      </Sequence>

      {/* Shot 1 */}
      <Sequence from={TITLE_DUR} durationInFrames={SHOT_DUR}>
        <Shot src={shot1} fadeIn fadeOut />
      </Sequence>

      {/* Shot 2 */}
      <Sequence from={TITLE_DUR + SHOT_DUR} durationInFrames={SHOT_DUR}>
        <Shot src={shot2} fadeIn fadeOut />
      </Sequence>

      {/* Shot 3 */}
      <Sequence from={TITLE_DUR + SHOT_DUR * 2} durationInFrames={SHOT_DUR}>
        <Shot src={shot3} fadeIn fadeOut />
      </Sequence>

      {/* End card */}
      <Sequence from={TITLE_DUR + SHOT_DUR * 3} durationInFrames={END_DUR}>
        <EndCard bgColor="#FF1B8D" tagline="CRAFTEDDISTILLERY.COM" />
      </Sequence>
    </div>
  );
};

module.exports = { PamplemousseCommercial, TitleCard, Shot, EndCard };
