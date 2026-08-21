import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@workspace/api-client-react";
import Settings from "./settings";

const apiState = vi.hoisted(() => ({
  usersQuery: {} as Record<string, unknown>,
  retentionQuery: {} as Record<string, unknown>,
  configQuery: {} as Record<string, unknown>,
  updateConfig: vi.fn(),
  refetchUsers: vi.fn(),
  refetchRetention: vi.fn(),
  refetchConfig: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetAppConfigQueryKey: () => ["config"],
  useListUsers: () => apiState.usersQuery,
  useListRetentionRequests: () => apiState.retentionQuery,
  useGetAppConfig: () => apiState.configQuery,
  useUpdateAppConfig: () => ({
    isPending: false,
    mutate: apiState.updateConfig,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: apiState.toast }),
}));

const config: AppConfig = {
  severityWeights: {
    fatal: 40,
    likely_fatal: 30,
    scoring_risk: 20,
    cosmetic: 10,
  },
  missingEvidenceWeight: 25,
  bandCutoffs: { medium: 25, high: 50, critical: 75 },
  firmName: "Valo",
  confidentialityLegend: "Confidential",
  retentionDefaultDays: 365,
  updatedAt: "2026-08-11T10:00:00.000Z",
  updatedBy: null,
};

function successfulQuery(data: unknown, refetch: () => unknown) {
  return {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    refetch,
  };
}

function failedQuery(refetch: () => unknown) {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isError: true,
    refetch,
  };
}

function pausedQuery(refetch: () => unknown) {
  return {
    data: undefined,
    isLoading: false,
    isPending: true,
    isError: false,
    refetch,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Settings />
    </QueryClientProvider>,
  );
}

describe("Settings", () => {
  beforeEach(() => {
    apiState.updateConfig.mockReset();
    apiState.refetchUsers.mockReset();
    apiState.refetchRetention.mockReset();
    apiState.refetchConfig.mockReset();
    apiState.toast.mockReset();
    apiState.usersQuery = successfulQuery([], apiState.refetchUsers);
    apiState.retentionQuery = successfulQuery([], apiState.refetchRetention);
    apiState.configQuery = successfulQuery(config, apiState.refetchConfig);
  });

  it("shows retryable errors instead of spinners or false empty states", () => {
    apiState.usersQuery = failedQuery(apiState.refetchUsers);
    apiState.retentionQuery = failedQuery(apiState.refetchRetention);
    apiState.configQuery = failedQuery(apiState.refetchConfig);

    renderPage();

    for (const [title, retry] of [
      ["Settings could not be loaded", apiState.refetchConfig],
      ["Personnel access could not be loaded", apiState.refetchUsers],
      ["Retention requests could not be loaded", apiState.refetchRetention],
    ] as const) {
      const panel = screen.getByText(title).closest('[role="alert"]');
      expect(panel).not.toBeNull();
      fireEvent.click(
        within(panel as HTMLElement).getByRole("button", { name: "Try again" }),
      );
      expect(retry).toHaveBeenCalledTimes(1);
    }

    expect(
      screen.queryByText(
        "No personnel records are available for this organisation.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No retention requests are available."),
    ).not.toBeInTheDocument();
  });

  it("keeps verified empty directories distinct from load failures", async () => {
    renderPage();

    expect(
      screen.getByText(
        "No personnel records are available for this organisation.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No retention requests are available."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByText("Settings could not be loaded"),
      ).not.toBeInTheDocument(),
    );
  });

  it("does not report cold paused configuration or directories as empty", () => {
    apiState.usersQuery = pausedQuery(apiState.refetchUsers);
    apiState.retentionQuery = pausedQuery(apiState.refetchRetention);
    apiState.configQuery = pausedQuery(apiState.refetchConfig);

    renderPage();

    expect(
      screen.queryByText(
        "No personnel records are available for this organisation.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No retention requests are available."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Settings could not be loaded"),
    ).not.toBeInTheDocument();
    expect(document.querySelectorAll(".animate-spin")).toHaveLength(4);
  });

  it("blocks non-integer configuration before calling the API", async () => {
    renderPage();

    fireEvent.change(await screen.findByLabelText("Fatal"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(apiState.updateConfig).not.toHaveBeenCalled();
    expect(apiState.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: "Invalid number settings",
      }),
    );
  });
});
