/**
 * The coordinates that keep a diverging judgment reachable.
 *
 * Not a formatting helper: feeding these to the consensus panel as
 * `requiredCoords` is the only thing that makes the owed rationale ACTIONABLE
 * at consensus. Without them the compare table suppresses its own Override
 * button on an untouched coordinate, the assess form is unmounted, and
 * `consensus → extract` is not a permitted transition — so a run that trips the
 * finalize 400 could only be cancelled.
 */
import { describe, expect, it } from "vitest";

import { rationaleGapCoords } from "@/lib/qa/rationaleGaps";

const INSTANCES = { "et-1": "inst-1", "et-2": "inst-2" };

const owed = {
  rationale_required: true,
  target_entity_type_id: "et-1",
  rationale_field_id: "r-1",
};

describe("rationaleGapCoords", () => {
  it("returns the rationale coordinate the server says is owed", () => {
    expect(rationaleGapCoords([owed], INSTANCES)).toEqual(["inst-1::r-1"]);
  });

  it("keys the rationale to its OWN entity type's instance", () => {
    expect(
      rationaleGapCoords(
        [{ ...owed, target_entity_type_id: "et-2", rationale_field_id: "r-2" }],
        INSTANCES,
      ),
    ).toEqual(["inst-2::r-2"]);
  });

  it("ignores entries the server did not flag", () => {
    expect(rationaleGapCoords([{ ...owed, rationale_required: false }], INSTANCES)).toEqual([]);
  });

  it("ignores an entry whose spec pointer no longer resolves", () => {
    // Null ids are the wire's way of saying the coordinate is gone. There is
    // nothing to point the manager at, so requiring it would block the run
    // on a box that cannot be rendered.
    expect(
      rationaleGapCoords([{ ...owed, rationale_field_id: null }], INSTANCES),
    ).toEqual([]);
    expect(
      rationaleGapCoords([{ ...owed, target_entity_type_id: null }], INSTANCES),
    ).toEqual([]);
  });

  it("ignores an entry whose section has no instance in this run", () => {
    expect(rationaleGapCoords([{ ...owed, target_entity_type_id: "et-9" }], INSTANCES)).toEqual(
      [],
    );
  });

  it("is empty before the run view or the session has loaded", () => {
    expect(rationaleGapCoords(undefined, INSTANCES)).toEqual([]);
    expect(rationaleGapCoords([owed], undefined)).toEqual([]);
  });

  it("collects every owed rationale, not just the first", () => {
    expect(
      rationaleGapCoords(
        [owed, { ...owed, target_entity_type_id: "et-2", rationale_field_id: "r-2" }],
        INSTANCES,
      ),
    ).toEqual(["inst-1::r-1", "inst-2::r-2"]);
  });
});
