import type { Person } from "../../domain/types.js";

const fmt = (value: number): string => value.toLocaleString("ru-RU");

interface StarsProps {
  person: Person;
  value: number | null;
  editable: boolean;
  onRate: (value: number) => void;
}

/** Ten stars; each editable star has two halves: the left rates i - 0.5, the right rates i. */
export function Stars({ person, value, editable, onRate }: StarsProps) {
  const stars = [];
  for (let i = 1; i <= 10; i++) {
    // Full when the star is at or below the value, half when it sits exactly on a half-step.
    const fill = value == null ? "" : i - 0.5 === value ? "half" : i <= value ? "on" : "";
    const glyph = fill === "" ? "☆" : "★";
    if (editable) {
      stars.push(
        <span key={i} className={`star${fill ? ` ${fill}` : ""}`}>
          {glyph}
          <button type="button" className="star-half star-half-left" aria-label={`${person}: ${fmt(i - 0.5)} из 10`} onClick={() => onRate(i - 0.5)} />
          <button type="button" className="star-half star-half-right" aria-label={`${person}: ${fmt(i)} из 10`} onClick={() => onRate(i)} />
        </span>
      );
    } else {
      stars.push(<span key={i} className={`star static${fill ? ` ${fill}` : ""}`}>{glyph}</span>);
    }
  }
  return (
    <>
      <span className="stars">{stars}</span>
      <span className="rating-value">{value != null ? fmt(value) : "—"}</span>
    </>
  );
}
