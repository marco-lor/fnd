export const reconcileManagerUserSelection = ({
  selectedUserIds = new Set(), currentUserIds = [], previousUserIds = [], isInitialLoad = false,
}) => {
  const current = new Set(currentUserIds.filter(Boolean));
  const previous = new Set(previousUserIds);
  const next = new Set([...selectedUserIds].filter((uid) => current.has(uid)));
  for (const uid of current) if (isInitialLoad || !previous.has(uid)) next.add(uid);
  return next.size === selectedUserIds.size && [...next].every((uid) => selectedUserIds.has(uid)) ? selectedUserIds : next;
};
