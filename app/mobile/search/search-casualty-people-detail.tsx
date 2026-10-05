"use client";

import { formatNumber } from "@/lib/format";
import {
  type SearchCasualtyPerson,
  searchCasualtyPersonCounts,
  searchCasualtyPersonStatusLabel,
  searchCasualtyPersonTreatmentLabel
} from "@/lib/search-casualty-person";

export function SearchCasualtyPeopleDetail({ people, className = "" }: { people: SearchCasualtyPerson[]; className?: string }) {
  if (people.length === 0) return null;
  const counts = searchCasualtyPersonCounts(people);
  return (
    <details className={`search-casualty-people-detail ${className}`.trim()}>
      <summary>נפגעים וחללים: <strong>{formatNumber(people.length)}</strong><small>חרדה {formatNumber(counts.anxiety)} · גוף {formatNumber(counts.physical)} · חללים {formatNumber(counts.deceased)}</small></summary>
      <ul>
        {people.map((person) => (
          <li key={person.residentId}>
            <strong>{[person.firstName, person.lastName].filter(Boolean).join(" ") || "ללא שם"}</strong>
            <span>קומה {person.floorNumber ?? "-"} · דירה {person.unitNumber}</span>
            <span>{searchCasualtyPersonStatusLabel(person.status)}</span>
            {person.requiresEvacuation ? <span>נדרש פינוי</span> : null}
            <span>{searchCasualtyPersonTreatmentLabel(person.casualtiesResolved)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
