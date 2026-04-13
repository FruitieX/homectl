type ConfigListSearchBarProps = {
  filteredCount: number;
  onChange: (value: string) => void;
  placeholder: string;
  totalCount: number;
  value: string;
};

export function ConfigListSearchBar({
  filteredCount,
  onChange,
  placeholder,
  totalCount,
  value,
}: ConfigListSearchBarProps) {
  const hasActiveSearch = value.trim().length > 0;

  return (
    <div className="card bg-base-200 shadow-xl">
      <div className="card-body gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="form-control w-full sm:max-w-sm">
          <span className="label-text text-sm">Search</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>

        <div className="flex items-center gap-3 text-sm opacity-70">
          <span>
            Showing {filteredCount} of {totalCount}
          </span>

          {hasActiveSearch && (
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => onChange('')}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}