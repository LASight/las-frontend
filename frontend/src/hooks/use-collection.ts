import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collectionGateway } from "../services/collection-service";
import { jobQueryKey } from "./use-digitization-job";

export function collectionQueryKey(id: string) {
  return ["digitization", "collection", id] as const;
}

export function useCollection(id: string | null | undefined) {
  const client = useQueryClient();
  return useQuery({
    queryKey: collectionQueryKey(id ?? ""),
    queryFn: async () => {
      const collection = await collectionGateway.get(id!);
      // The collection poll is authoritative for every member, including a
      // task started before this page mounted. Cancel older individual reads
      // before publishing so a late response cannot relock a completed editor.
      await Promise.all(collection.segments.map(({ job_id }) =>
        client.cancelQueries({ queryKey: jobQueryKey(job_id), exact: true })));
      for (const { job } of collection.segments) {
        client.setQueryData(jobQueryKey(job.job_id), job);
      }
      return collection;
    },
    enabled: !!id,
    refetchOnMount: "always",
    refetchInterval: (query) => query.state.data?.segments.some(({ job }) => job.phase === "segmenting") ? 1200 : false,
  });
}
