export const reconcileManagerUserSelection = ({
  selectedUserIds = [],
  currentUserIds = [],
  previousUserIds = [],
  isInitialLoad = false,
}) => {
  const currentIds = Array.from(new Set(currentUserIds.filter(Boolean)));
  const currentIdSet = new Set(currentIds);
  const previousIdSet = new Set(previousUserIds.filter(Boolean));
  const stillSelected = selectedUserIds.filter((id) => currentIdSet.has(id));
  const additions = isInitialLoad
    ? currentIds
    : currentIds.filter((id) => !previousIdSet.has(id));

  return Array.from(new Set([...stillSelected, ...additions]));
};
