export const emptySelectionState = {
	selectedTaskId: null as string | null,
};

export const reconcileSelectedTaskId = (
	selectedTaskId: string | null,
	visibleTaskIds: readonly string[],
): string | null => {
	if (selectedTaskId === null) {
		return null;
	}
	return visibleTaskIds.includes(selectedTaskId) ? selectedTaskId : null;
};
