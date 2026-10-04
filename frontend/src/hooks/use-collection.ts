import { useQuery } from "@tanstack/react-query";
import { collectionGateway } from "../services/collection-service";

export function collectionQueryKey(id: string) {
  return ["digitization", "collection", id] as const;
}

export function useCollection(id: string | null | undefined) {
  return useQuery({
    queryKey: collectionQueryKey(id ?? ""),
    queryFn: () => collectionGateway.get(id!),
    enabled: !!id,
    refetchOnMount: "always",
    refetchInterval: (query) => query.state.data?.segments.some(({ job }) => job.phase === "segmenting") ? 1200 : false,
  });
}
