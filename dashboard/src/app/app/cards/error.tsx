"use client";

export default function CardsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page">
      <div className="empty-state">
        <strong>Something went wrong</strong>
        <p>{error.message || "The cards page failed to load. Please try again."}</p>
        <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--background)", cursor: "pointer", fontSize: 13 }}>
          Retry
        </button>
      </div>
    </div>
  );
}
