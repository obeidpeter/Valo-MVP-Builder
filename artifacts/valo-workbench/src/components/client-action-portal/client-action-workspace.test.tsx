import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientActionWorkspace } from "./client-action-workspace";

const USER = "33333333-3333-4333-8333-333333333333";
const RECIPIENT = "77777777-7777-4777-8777-777777777777";

describe("ClientActionWorkspace", () => {
  it("shows the no-bypass boundary and emits a version-bound acknowledgement", () => {
    const onMutate = vi.fn();
    render(
      <ClientActionWorkspace
        currentUserId={USER}
        canReview={false}
        onMutate={onMutate}
        snapshot={{
          organisationId: "11111111-1111-4111-8111-111111111111",
          projectId: "22222222-2222-4222-8222-222222222222",
          authority: {
            externalMessaging: false,
            rawUpload: false,
            packageTransfer: false,
            uploadIntentOnly: true,
          },
          records: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              kind: "evidence_request",
              version: 3,
              createdByUserId: "55555555-5555-4555-8555-555555555555",
              recipientUserId: USER,
              purpose: "tender_evidence",
              purposeStatement: "Provide the current certificate.",
              dueAt: null,
              status: "open",
              requestAcknowledgement: null,
              slots: [
                {
                  id: "66666666-6666-4666-8666-666666666666",
                  label: "Certificate",
                  required: true,
                  acceptedContentTypes: ["application/pdf"],
                  attempts: [],
                },
              ],
              completionReceiptSha256: null,
              externalMessageSentByValo: false,
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByText(
        /does not upload a file, send a message or transfer a package/i,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /acknowledge request/i }),
    );
    expect(onMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ expectedVersion: 3 }),
      }),
    );
  });

  it("creates a purpose-bound request with a named selector and no opaque ID field", () => {
    const onMutate = vi.fn();
    render(
      <ClientActionWorkspace
        currentUserId={USER}
        canReview={false}
        canCreateEvidenceRequest
        authorityState="ready"
        authorityOptions={[{ userId: RECIPIENT, name: "Evidence Contributor" }]}
        onMutate={onMutate}
        snapshot={{
          organisationId: "11111111-1111-4111-8111-111111111111",
          projectId: "22222222-2222-4222-8222-222222222222",
          authority: {
            externalMessaging: false,
            rawUpload: false,
            packageTransfer: false,
            uploadIntentOnly: true,
          },
          records: [],
        }}
      />,
    );
    expect(
      screen.queryByLabelText(/recipient user id/i),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/named recipient/i), {
      target: { value: RECIPIENT },
    });
    fireEvent.change(screen.getByLabelText(/purpose statement/i), {
      target: { value: "Provide the current insurance certificate." },
    });
    fireEvent.change(screen.getByLabelText(/required evidence/i), {
      target: { value: "Insurance certificate" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /record evidence request/i }),
    );
    expect(onMutate).toHaveBeenCalledWith({
      path: "evidence-requests",
      body: {
        purpose: "tender_evidence",
        purposeStatement: "Provide the current insurance certificate.",
        recipientUserId: RECIPIENT,
        dueAt: null,
        slots: [
          {
            label: "Insurance certificate",
            required: true,
            acceptedContentTypes: ["application/pdf"],
          },
        ],
      },
    });
  });
});
