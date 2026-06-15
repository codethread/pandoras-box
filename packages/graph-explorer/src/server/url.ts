export const formatHostForUrl = (host: string): string => {
	if (host.startsWith("[") && host.endsWith("]")) {
		return host;
	}
	return host.includes(":") ? `[${host}]` : host;
};

export const baseUrlForHost = (host: string): string => `http://${formatHostForUrl(host)}`;
