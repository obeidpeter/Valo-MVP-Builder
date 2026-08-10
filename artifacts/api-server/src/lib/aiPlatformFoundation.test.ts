import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONTINUOUS_EVAL_FOUNDATION_STATUS,
  AI_CONTROL_PLANE_FOUNDATION_STATUS,
  AI_RETRIEVAL_FOUNDATION_STATUS,
  assessAiHumanReviewRisk,
  buildEvidenceGradeRetrievalContext,
  evaluateContinuousAiCandidate,
} from "./aiPlatformFoundation";

test("the combined AI platform foundation remains explicitly disconnected", () => {
  assert.deepEqual(AI_RETRIEVAL_FOUNDATION_STATUS, {
    runtimeConnected: false,
    productionApproved: false,
    activation: "blocked",
  });
  assert.deepEqual(AI_CONTROL_PLANE_FOUNDATION_STATUS, {
    runtimeConnected: false,
    durableStoreConnected: false,
    productionApproved: false,
    activation: "blocked",
  });
  assert.deepEqual(AI_CONTINUOUS_EVAL_FOUNDATION_STATUS, {
    runtimeConnected: false,
    evaluationWriterConnected: false,
    productionApproved: false,
    activation: "blocked",
  });
  assert.equal(typeof buildEvidenceGradeRetrievalContext, "function");
  assert.equal(typeof assessAiHumanReviewRisk, "function");
  assert.equal(typeof evaluateContinuousAiCandidate, "function");
});
