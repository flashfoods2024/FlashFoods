import http from "k6/http";

export const options = {
  scenarios: {
    burst_test: {
      executor: "constant-arrival-rate",
      rate: 100,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 6000,
    },
  },
};

export default function () {
  http.get("https://app.flashfoods.freehosting.dev/");
}
