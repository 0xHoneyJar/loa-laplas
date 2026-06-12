// The shell is just another consumer (SDD §1): one page iframing the
// SAME-ORIGIN engine. file:// stays a local affordance of the engine file;
// the deployed path is always same-origin static (PRD BLOCKER-2).
export default function ObservatoryPage() {
  return (
    <iframe
      src="/observatory/game.html"
      title="The Observatory"
      style={{
        display: "block",
        width: "100vw",
        height: "100vh",
        border: "none",
      }}
    />
  );
}
