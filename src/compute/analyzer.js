export function analyze(numbers) {
	if (
		!Array.isArray(numbers) ||
		numbers.length === 0 ||
		!numbers.every(Number.isFinite)
	) {
		throw new TypeError("numbers must be a non-empty array of numbers");
	}

	const count = numbers.length;
	const sum = numbers.reduce((total, number) => total + number, 0);

	return {
		count,
		sum,
		average: sum / count,
		min: Math.min(...numbers),
		max: Math.max(...numbers),
	};
}
