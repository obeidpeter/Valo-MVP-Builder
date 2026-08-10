import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";
import IntelligenceCentreRoute from "./intelligence-centre-route";

const projectRefetch = vi.fn();
const intelligenceRefetch = vi.fn();
const getIntelligence = vi.fn();

const state = {
  projectsError: false,
  permissions: [
    "client:read",
    "project:read",
    "document:read",
    "requirement:read",
    "evidence:read",
    "defect:read",
    "report:read",
    "draft:read",
    "package:read",
  ],
  projects: [
    {
      id: "project-1",
      tenderTitle: "Road rehabilitation",
    },
    {
      id: "project-2",
      tenderTitle: "Hospital equipment",
    },
  ],
};

vi.mock("@workspace/api-client-react", () => ({
  getGetProjectIntelligenceQueryKey: (projectId: string) => [
    "/api/projects/intelligence",
    projectId,
  ],
  useListProjects: () => ({
    data: state.projects,
    isLoading: false,
    isError: state.projectsError,
    refetch: projectRefetch,
  }),
  useGetProjectIntelligence: (...args: unknown[]) => getIntelligence(...args),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: { id: "org-1" },
    effectivePermissions: state.permissions,
  }),
}));

function snapshot(projectId: string) {
  return {
    environment: "development" as const,
    productionAiEnabled: false,
    restrictedMode: false,
    generatedAt: "2026-08-10T12:00:00.000Z",
    project: {
      id: projectId,
      title:
        projectId === "project-2"
          ? "Hospital equipment"
          : "Road rehabilitation",
      status: "review",
      deadline: null,
    },
    capabilities: [],
  };
}

function renderAt(path: string) {
  const location = memoryLocation({ path });
  render(
    <Router hook={location.hook}>
      <IntelligenceCentreRoute />
    </Router>,
  );
}

describe("Intelligence Centre route", () => {
  beforeEach(() => {
    state.projectsError = false;
    state.permissions = [
      "client:read",
      "project:read",
      "document:read",
      "requirement:read",
      "evidence:read",
      "defect:read",
      "report:read",
      "draft:read",
      "package:read",
    ];
    state.projects = [
      { id: "project-1", tenderTitle: "Road rehabilitation" },
      { id: "project-2", tenderTitle: "Hospital equipment" },
    ];
    projectRefetch.mockReset();
    intelligenceRefetch.mockReset();
    getIntelligence.mockReset();
    getIntelligence.mockImplementation((projectId: string) => ({
      data: snapshot(projectId),
      isLoading: false,
      isError: false,
      refetch: intelligenceRefetch,
    }));
  });

  it("honours a deep-linked project and switches within the authorised list", async () => {
    renderAt("/intelligence?project=project-2");

    const projectSelect = screen.getByRole("combobox", { name: "Pursuit" });
    expect(projectSelect).toHaveValue("project-2");
    expect(getIntelligence).toHaveBeenCalledWith(
      "project-2",
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );

    await userEvent.selectOptions(projectSelect, "project-1");
    expect(getIntelligence).toHaveBeenLastCalledWith(
      "project-1",
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it("keeps project transport failures distinct and retryable", async () => {
    state.projectsError = true;
    state.projects = [];
    renderAt("/intelligence");

    expect(
      screen.getByRole("heading", {
        name: "Intelligence evidence could not be loaded",
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(projectRefetch).toHaveBeenCalledTimes(1);
    expect(intelligenceRefetch).not.toHaveBeenCalled();
  });

  it("fails closed before loading combined source content when one read grant is missing", () => {
    state.permissions = state.permissions.filter(
      (permission) => permission !== "document:read",
    );
    renderAt("/intelligence?project=project-1");

    expect(
      screen.getByRole("heading", {
        name: "Intelligence source access required",
      }),
    ).toBeInTheDocument();
    expect(getIntelligence).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("shows an honest empty catalogue when there are no visible pursuits", () => {
    state.projects = [];
    renderAt("/intelligence");

    expect(
      screen.getByRole("heading", {
        name: "No intelligence evidence is available",
      }),
    ).toBeInTheDocument();
    expect(getIntelligence).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
  });
});
