// Racine Remotion pour la brique Hero Ad. N'affecte pas CherryRiverCommercial.
const { registerRoot, Composition } = require("remotion");
const { HeroProductAd } = require("./HeroProductAd");

const FPS = 30;
const DURATION = 6 * FPS;

// Aucun placeholder externe. Le renderer doit toujours fournir l'asset réel.
const defaults = {
  productImage: "",
  brandName: "",
  kicker: "",
  tagline: "",
  accent: "#FF1B8D",
  backgroundVideo: null,
};

const Root = () => (
  <>
    <Composition
      id="HeroAdVertical"
      component={HeroProductAd}
      durationInFrames={DURATION}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={defaults}
    />
    <Composition
      id="HeroAdHorizontal"
      component={HeroProductAd}
      durationInFrames={DURATION}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={defaults}
    />
  </>
);

registerRoot(Root);
